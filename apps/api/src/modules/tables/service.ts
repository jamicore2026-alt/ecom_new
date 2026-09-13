import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { outlets, tableSections, tables, tableSessions, orders, menuItems, products, menuItemOutlets } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound, conflict } from '../../shared/errors'
import { isTableState, assertTableTransition, assertSessionTransition, isSessionStatus } from '../../shared/table-state'
import { isFoodOrderType } from '../../shared/order-state'
import { assertInOutletScope, effectiveOutletIds, outletScopeError, type OutletScope } from '../../shared/outlet-scope'
import type { TableState } from '../../shared/types'

const genToken = () => crypto.randomUUID().replace(/-/g, '') + Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString('hex')

/* ------------------------------ section service ------------------------------ */

export class TableSectionsService {
  static async list(db: DB, merchantId: string, scope: OutletScope) {
    const ids = effectiveOutletIds(scope)
    if (ids === null) return ok([])
    const sections = await db
      .select({
        id: tableSections.id,
        name: tableSections.name,
        sortOrder: tableSections.sortOrder,
        status: tableSections.status,
        outletId: tableSections.outletId,
        outletName: outlets.name
      })
      .from(tableSections)
      .innerJoin(outlets, eq(tableSections.outletId, outlets.id))
      .where(and(eq(tableSections.merchantId, merchantId), inArray(tableSections.outletId, ids)))
      .orderBy(asc(tableSections.sortOrder), asc(tableSections.name))

    return ok(sections)
  }

  static async create(db: DB, merchantId: string, input: { name: string; sortOrder?: number; status?: string; outletId: string }, scope: OutletScope) {
    assertInOutletScope(scope, input.outletId)
    const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.outletId), eq(outlets.merchantId, merchantId)))
    if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')

    const [dup] = await db
      .select()
      .from(tableSections)
      .where(and(eq(tableSections.merchantId, merchantId), eq(tableSections.outletId, input.outletId), eq(tableSections.name, input.name)))
    if (dup) throw conflict('SECTION_EXISTS', `A section named "${input.name}" already exists in this outlet`)

    const [row] = await db.insert(tableSections).values({
      merchantId,
      outletId: input.outletId,
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      status: input.status ?? 'active'
    }).returning()
    return ok(row)
  }

  static async update(db: DB, merchantId: string, id: string, input: { name?: string; sortOrder?: number; status?: string }, scope: OutletScope) {
    const [existing] = await db.select().from(tableSections).where(and(eq(tableSections.id, id), eq(tableSections.merchantId, merchantId)))
    if (!existing) throw notFound('SECTION_NOT_FOUND', 'Table section not found')
    assertInOutletScope(scope, existing.outletId)

    if (input.name && input.name !== existing.name) {
      const [dup] = await db
        .select()
        .from(tableSections)
        .where(and(eq(tableSections.merchantId, merchantId), eq(tableSections.outletId, existing.outletId), eq(tableSections.name, input.name)))
      if (dup) throw conflict('SECTION_EXISTS', `A section named "${input.name}" already exists in this outlet`)
    }

    const [updated] = await db.update(tableSections).set({
      name: input.name ?? existing.name,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      status: input.status ?? existing.status
    }).where(eq(tableSections.id, id)).returning()
    return ok(updated)
  }

  static async remove(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [existing] = await db.select().from(tableSections).where(and(eq(tableSections.id, id), eq(tableSections.merchantId, merchantId)))
    if (!existing) throw notFound('SECTION_NOT_FOUND', 'Table section not found')
    assertInOutletScope(scope, existing.outletId)
    await db.delete(tableSections).where(eq(tableSections.id, id))
    return ok({ id, deleted: true })
  }
}

/* -------------------------------- table service -------------------------------- */

export class TablesService {
  static async list(db: DB, merchantId: string, query: { outletId?: string; sectionId?: string; status?: string }, scope: OutletScope) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok([])
    const conds = [eq(tables.merchantId, merchantId), inArray(tables.outletId, scopedIds)]
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(tables.outletId, query.outletId))
    }
    if (query.sectionId) conds.push(eq(tables.sectionId, query.sectionId))
    if (query.status) {
      if (!isTableState(query.status)) throw badRequest('INVALID_TABLE_STATE', 'Unknown table state')
      conds.push(eq(tables.status, query.status))
    }

    const openSessions = await db
      .select()
      .from(tableSessions)
      .where(and(eq(tableSessions.merchantId, merchantId), eq(tableSessions.status, 'OPEN')))
    const byTable = new Map<string, typeof openSessions[number]>()
    for (const s of openSessions) if (s.tableId && !byTable.has(s.tableId)) byTable.set(s.tableId, s)

    const rows = await db
      .select({
        id: tables.id,
        name: tables.name,
        code: tables.code,
        seats: tables.seats,
        status: tables.status,
        outletId: tables.outletId,
        sectionId: tables.sectionId,
        sectionName: tableSections.name,
        qrToken: tables.qrToken,
        createdAt: tables.createdAt
      })
      .from(tables)
      .leftJoin(tableSections, eq(tables.sectionId, tableSections.id))
      .where(and(...conds))
      .orderBy(asc(tableSections.sortOrder), asc(tables.code))

    const withMeta = await Promise.all(
      rows.map(async (row) => {
        const open = byTable.get(row.id)
        let orderCount = 0
        let total = 0
        if (open) {
          const agg = await db
            .select({ c: count(), t: orders.total })
            .from(orders)
            .where(and(eq(orders.merchantId, merchantId), eq(orders.tableSessionId, open.id), eq(orders.status, 'COMPLETED')))
          orderCount = agg.length
          total = agg.reduce((a, r) => a + r.t, 0)
        }
        return { ...row, openSession: open ? { id: open.id, guests: open.guests, openedAt: open.openedAt, notes: open.notes } : null, orderCount, total }
      })
    )

    return ok(withMeta)
  }

  static async get(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [row] = await db
      .select({
        id: tables.id,
        name: tables.name,
        code: tables.code,
        seats: tables.seats,
        status: tables.status,
        outletId: tables.outletId,
        sectionId: tables.sectionId,
        sectionName: tableSections.name,
        qrToken: tables.qrToken,
        createdAt: tables.createdAt
      })
      .from(tables)
      .leftJoin(tableSections, eq(tables.sectionId, tableSections.id))
      .where(and(eq(tables.id, id), eq(tables.merchantId, merchantId)))
    if (!row) throw notFound('TABLE_NOT_FOUND', 'Table not found')
    assertInOutletScope(scope, row.outletId)
    return ok(row)
  }

  static async create(db: DB, merchantId: string, input: { outletId: string; sectionId?: string; name: string; code: string; seats: number }, scope: OutletScope) {
    assertInOutletScope(scope, input.outletId)
    const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.outletId), eq(outlets.merchantId, merchantId)))
    if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')
    if (input.sectionId) {
      const [sec] = await db.select().from(tableSections).where(and(eq(tableSections.id, input.sectionId), eq(tableSections.merchantId, merchantId)))
      if (!sec) throw notFound('SECTION_NOT_FOUND', 'Table section not found')
    }
    const [dupCode] = await db
      .select()
      .from(tables)
      .where(and(eq(tables.merchantId, merchantId), eq(tables.outletId, input.outletId), eq(tables.code, input.code)))
    if (dupCode) throw conflict('TABLE_EXISTS', `A table with code "${input.code}" already exists in this outlet`)
    const [dupName] = await db
      .select()
      .from(tables)
      .where(and(eq(tables.merchantId, merchantId), eq(tables.outletId, input.outletId), eq(tables.name, input.name)))
    if (dupName) throw conflict('TABLE_EXISTS', `A table named "${input.name}" already exists in this outlet`)

    const [row] = await db.insert(tables).values({
      merchantId,
      outletId: input.outletId,
      sectionId: input.sectionId ?? null,
      name: input.name,
      code: input.code,
      seats: input.seats,
      qrToken: genToken()
    }).returning()
    return ok(row)
  }

  static async update(db: DB, merchantId: string, id: string, input: { sectionId?: string; name?: string; code?: string; seats?: number }, scope: OutletScope) {
    const [existing] = await db.select().from(tables).where(and(eq(tables.id, id), eq(tables.merchantId, merchantId)))
    if (!existing) throw notFound('TABLE_NOT_FOUND', 'Table not found')
    assertInOutletScope(scope, existing.outletId)
    if (input.sectionId) {
      const [sec] = await db.select().from(tableSections).where(and(eq(tableSections.id, input.sectionId), eq(tableSections.merchantId, merchantId)))
      if (!sec) throw notFound('SECTION_NOT_FOUND', 'Table section not found')
    }
    const [updated] = await db.update(tables).set({
      sectionId: input.sectionId !== undefined ? input.sectionId : existing.sectionId,
      name: input.name ?? existing.name,
      code: input.code ?? existing.code,
      seats: input.seats ?? existing.seats
    }).where(eq(tables.id, id)).returning()
    return ok(updated)
  }

  static async status(db: DB, merchantId: string, id: string, next: string, scope: OutletScope) {
    const [table] = await db.select().from(tables).where(and(eq(tables.id, id), eq(tables.merchantId, merchantId)))
    if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found')
    assertInOutletScope(scope, table.outletId)
    assertTableTransition(table.status, next)
    const [updated] = await db.update(tables).set({ status: next as TableState }).where(eq(tables.id, id)).returning()
    return ok(updated)
  }

  static async qr(db: DB, merchantId: string, id: string, baseUrl?: string, scope?: OutletScope) {
    const [table] = await db.select().from(tables).where(and(eq(tables.id, id), eq(tables.merchantId, merchantId)))
    if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found')
    if (scope) assertInOutletScope(scope, table.outletId)
    const url = `${baseUrl ?? 'https://store'}${table.qrToken}`
    return ok({ token: table.qrToken, url, image: `/api/table-qr/${table.qrToken}/qr.svg` })
  }

  static async remove(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [existing] = await db.select().from(tables).where(and(eq(tables.id, id), eq(tables.merchantId, merchantId)))
    if (!existing) throw notFound('TABLE_NOT_FOUND', 'Table not found')
    assertInOutletScope(scope, existing.outletId)
    const [open] = await db.select().from(tableSessions).where(and(eq(tableSessions.merchantId, merchantId), eq(tableSessions.tableId, id), eq(tableSessions.status, 'OPEN')))
    if (open) throw conflict('TABLE_OCCUPIED', 'Close the open session before removing this table')
    await db.delete(tables).where(eq(tables.id, id))
    return ok({ id, deleted: true })
  }
}

/* ------------------------------ session service ------------------------------ */

export class TablesSessionService {
  static async list(db: DB, merchantId: string, query: { status?: string; outletId?: string; tableId?: string }, scope: OutletScope) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok([])
    const conds = [eq(tableSessions.merchantId, merchantId), inArray(tableSessions.outletId, scopedIds)]
    if (query.status) {
      if (!isSessionStatus(query.status)) throw badRequest('INVALID_SESSION_STATUS', 'Unknown session status')
      conds.push(eq(tableSessions.status, query.status))
    }
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(tableSessions.outletId, query.outletId))
    }
    if (query.tableId) conds.push(eq(tableSessions.tableId, query.tableId))

    const rows = await db
      .select({
        id: tableSessions.id,
        status: tableSessions.status,
        guests: tableSessions.guests,
        tableId: tableSessions.tableId,
        tableName: tables.name,
        tableCode: tables.code,
        sectionId: tables.sectionId,
        sectionName: tableSections.name,
        outletId: tableSessions.outletId,
        notes: tableSessions.notes,
        openedAt: tableSessions.openedAt,
        closedAt: tableSessions.closedAt
      })
      .from(tableSessions)
      .leftJoin(tables, eq(tableSessions.tableId, tables.id))
      .leftJoin(tableSections, eq(tables.sectionId, tableSections.id))
      .where(and(...conds))
      .orderBy(desc(tableSessions.openedAt))

    const withMeta = await Promise.all(
      rows.map(async (row) => {
        const agg = await db
          .select({ orderNumber: orders.orderNumber, total: orders.total, status: orders.status })
          .from(orders)
          .where(and(eq(orders.merchantId, merchantId), eq(orders.tableSessionId, row.id)))
        return { ...row, orderCount: agg.length, total: agg.reduce((a, o) => a + o.total, 0), orders: agg }
      })
    )
    return ok(withMeta)
  }

  static async get(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [row] = await db
      .select({
        id: tableSessions.id,
        status: tableSessions.status,
        guests: tableSessions.guests,
        tableId: tableSessions.tableId,
        tableName: tables.name,
        tableCode: tables.code,
        sectionName: tableSections.name,
        outletId: tableSessions.outletId,
        notes: tableSessions.notes,
        openedAt: tableSessions.openedAt,
        closedAt: tableSessions.closedAt
      })
      .from(tableSessions)
      .leftJoin(tables, eq(tableSessions.tableId, tables.id))
      .leftJoin(tableSections, eq(tables.sectionId, tableSections.id))
      .where(and(eq(tableSessions.id, id), eq(tableSessions.merchantId, merchantId)))
    if (!row) throw notFound('SESSION_NOT_FOUND', 'Table session not found')
    assertInOutletScope(scope, row.outletId)
    return ok(row)
  }

  static async open(db: DB, merchantId: string, input: { tableId: string; guests?: number; notes?: string }, scope: OutletScope) {
    const [table] = await db.select().from(tables).where(and(eq(tables.id, input.tableId), eq(tables.merchantId, merchantId)))
    if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found')
    assertInOutletScope(scope, table.outletId)
    // Fresh seating only when the table is empty/ready (or explicitly available).
    if (!['AVAILABLE', 'RESERVED', 'CLEANING'].includes(table.status)) {
      throw conflict('TABLE_OCCUPIED', `Table ${table.name} is currently ${table.status.toLowerCase()}`)
    }
    if (table.seats > 0 && input.guests && input.guests > table.seats) {
      throw conflict('GUESTS_EXCEED_SEATS', `Table ${table.name} seats ${table.seats} guests`)
    }
    const outletId = table.outletId

    const session = await db.transaction(async (tx) => {
      const [s] = await tx.insert(tableSessions).values({
        merchantId,
        outletId,
        tableId: table.id,
        guests: input.guests ?? 1,
        notes: input.notes ?? null
      }).returning()
      await tx.update(tables).set({ status: 'ORDERING' }).where(eq(tables.id, table.id))
      return s
    })
    return this.get(db, merchantId, session.id, scope)
  }

  static async close(db: DB, merchantId: string, id: string, scope: OutletScope) {
    return this.finish(db, merchantId, id, 'CLOSED', scope)
  }

  static async cancel(db: DB, merchantId: string, id: string, scope: OutletScope) {
    return this.finish(db, merchantId, id, 'CANCELLED', scope)
  }

  private static async finish(db: DB, merchantId: string, id: string, nextStatus: 'CLOSED' | 'CANCELLED', scope: OutletScope) {
    const [session] = await db.select().from(tableSessions).where(and(eq(tableSessions.id, id), eq(tableSessions.merchantId, merchantId)))
    if (!session) throw notFound('SESSION_NOT_FOUND', 'Table session not found')
    assertInOutletScope(scope, session.outletId)
    assertSessionTransition(session.status, nextStatus)
    if (!session.tableId) throw conflict('NO_TABLE', 'This session is not on a table')

    const [table] = await db.select().from(tables).where(and(eq(tables.id, session.tableId), eq(tables.merchantId, merchantId)))

    await db.transaction(async (tx) => {
      await tx.update(tableSessions).set({ status: nextStatus, closedAt: new Date() }).where(eq(tableSessions.id, id))
      if (table) await tx.update(tables).set({ status: 'CLEANING' }).where(eq(tables.id, table.id))
    })
    return this.get(db, merchantId, id, scope)
  }

  /** Move this OPEN session (and its orders) to another table. */
  static async move(db: DB, merchantId: string, id: string, toTableId: string, scope: OutletScope) {
    const [session] = await db.select().from(tableSessions).where(and(eq(tableSessions.id, id), eq(tableSessions.merchantId, merchantId)))
    if (!session) throw notFound('SESSION_NOT_FOUND', 'Table session not found')
    assertInOutletScope(scope, session.outletId)
    if (session.status !== 'OPEN') throw conflict('SESSION_NOT_OPEN', 'Only an open session can be moved')
    if (!session.tableId) throw conflict('NO_TABLE', 'This session is not on a table')

    const [fromTable] = await db.select().from(tables).where(and(eq(tables.id, session.tableId), eq(tables.merchantId, merchantId)))
    const [toTable] = await db.select().from(tables).where(and(eq(tables.id, toTableId), eq(tables.merchantId, merchantId)))
    if (!toTable) throw notFound('TABLE_NOT_FOUND', 'Destination table not found')
    assertInOutletScope(scope, toTable.outletId)
    if (!['AVAILABLE', 'RESERVED', 'CLEANING'].includes(toTable.status)) {
      throw conflict('TABLE_OCCUPIED', `Destination table ${toTable.name} is not free`)
    }

    await db.transaction(async (tx) => {
      await tx.update(tableSessions).set({ tableId: toTable.id, outletId: toTable.outletId }).where(eq(tableSessions.id, id))
      await tx.update(orders).set({ outletId: toTable.outletId }).where(and(eq(orders.tableSessionId, id), eq(orders.merchantId, merchantId)))
      await tx.update(tables).set({ status: 'ORDERING' }).where(eq(tables.id, toTable.id))
      if (fromTable) await tx.update(tables).set({ status: 'CLEANING' }).where(eq(tables.id, fromTable.id))
    })
    return this.get(db, merchantId, id, scope)
  }

  /** Merge other OPEN sessions into this one (their orders + guests join the target table; those tables are freed). */
  static async merge(db: DB, merchantId: string, targetId: string, sessionIds: string[], scope: OutletScope) {
    const [target] = await db.select().from(tableSessions).where(and(eq(tableSessions.id, targetId), eq(tableSessions.merchantId, merchantId)))
    if (!target) throw notFound('SESSION_NOT_FOUND', 'Target table session not found')
    assertInOutletScope(scope, target.outletId)
    if (target.status !== 'OPEN') throw conflict('SESSION_NOT_OPEN', 'Target session must be open')

    const sources = await db.select().from(tableSessions).where(and(eq(tableSessions.merchantId, merchantId), inArray(tableSessions.id, sessionIds)))
    for (const s of sources) assertInOutletScope(scope, s.outletId)
    const valid = sources.filter((s) => s.status === 'OPEN')
    if (valid.length === 0) throw notFound('SESSION_NOT_FOUND', 'No open sessions to merge')

    await db.transaction(async (tx) => {
      const guestSum = target.guests + valid.reduce((a, s) => a + s.guests, 0)
      await tx.update(tableSessions).set({ guests: guestSum }).where(eq(tableSessions.id, targetId))
      for (const s of valid) {
        await tx.update(orders).set({ tableSessionId: targetId }).where(and(eq(orders.tableSessionId, s.id), eq(orders.merchantId, merchantId)))
        await tx.update(tableSessions).set({ status: 'CLOSED', closedAt: new Date() }).where(eq(tableSessions.id, s.id))
        if (s.tableId) await tx.update(tables).set({ status: 'CLEANING' }).where(eq(tables.id, s.tableId))
      }
    })
    return this.get(db, merchantId, targetId, scope)
  }

  /** Split a party: move `guests` from this OPEN session into a new session on `toTableId`. */
  static async split(db: DB, merchantId: string, id: string, toTableId: string, guests: number, scope: OutletScope) {
    const [session] = await db.select().from(tableSessions).where(and(eq(tableSessions.id, id), eq(tableSessions.merchantId, merchantId)))
    if (!session) throw notFound('SESSION_NOT_FOUND', 'Table session not found')
    assertInOutletScope(scope, session.outletId)
    if (session.status !== 'OPEN') throw conflict('SESSION_NOT_OPEN', 'Only an open session can be split')
    if (guests <= 0 || guests >= session.guests) throw badRequest('INVALID_SPLIT', `Split guests must be between 1 and ${session.guests - 1}`)

    const [toTable] = await db.select().from(tables).where(and(eq(tables.id, toTableId), eq(tables.merchantId, merchantId)))
    if (!toTable) throw notFound('TABLE_NOT_FOUND', 'Destination table not found')
    assertInOutletScope(scope, toTable.outletId)
    if (!['AVAILABLE', 'RESERVED', 'CLEANING'].includes(toTable.status)) {
      throw conflict('TABLE_OCCUPIED', `Destination table ${toTable.name} is not free`)
    }

    const [newSession] = await db.transaction(async (tx) => {
      const [s] = await tx.insert(tableSessions).values({
        merchantId,
        outletId: toTable.outletId,
        tableId: toTable.id,
        guests,
        notes: `Split from ${session.id}`
      }).returning()
      await tx.update(tableSessions).set({ guests: session.guests - guests }).where(eq(tableSessions.id, id))
      await tx.update(tables).set({ status: 'ORDERING' }).where(eq(tables.id, toTable.id))
      return [s]
    })
    const origin = await this.get(db, merchantId, id, scope)
    const arrived = await this.get(db, merchantId, newSession.id, scope)
    return ok({ session: origin.data, splitInto: arrived.data })
  }

  /** Attach an existing food order to an OPEN session (dine-in linking). */
  static async attachOrder(db: DB, merchantId: string, id: string, orderId: string, scope: OutletScope) {
    const [session] = await db.select().from(tableSessions).where(and(eq(tableSessions.id, id), eq(tableSessions.merchantId, merchantId)))
    if (!session) throw notFound('SESSION_NOT_FOUND', 'Table session not found')
    assertInOutletScope(scope, session.outletId)
    if (session.status !== 'OPEN') throw conflict('SESSION_NOT_OPEN', 'Only an open session can take orders')

    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')
    if (!isFoodOrderType(order.orderType)) throw badRequest('NOT_FOOD_ORDER', 'Only a food order can be attached to a table session')
    if (order.tableSessionId) throw conflict('ORDER_ATTACHED', 'This order already belongs to a session')

    await db.update(orders).set({ tableSessionId: id, outletId: session.outletId }).where(eq(orders.id, order.id))
    return this.get(db, merchantId, id, scope)
  }
}

/* ------------------------------ public QR context ------------------------------ */

export class TableQrService {
  /** Resolve an opaque QR token into public table context + available menu. NO private data, NO auth. */
  static async context(db: DB, token: string) {
    const [table] = await db
      .select({
        id: tables.id,
        name: tables.name,
        code: tables.code,
        seats: tables.seats,
        status: tables.status,
        outletId: tables.outletId,
        outletName: outlets.name,
        merchantId: tables.merchantId
      })
      .from(tables)
      .innerJoin(outlets, eq(tables.outletId, outlets.id))
      .where(eq(tables.qrToken, token))
    if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found')

    const menu = await db
      .select({
        id: menuItems.id,
        name: products.name,
        description: products.description,
        price: products.price,
        taxRate: menuItems.taxRate,
        available: menuItems.available,
        status: menuItems.status,
        sortOrder: menuItems.sortOrder
      })
      .from(menuItems)
      .innerJoin(products, eq(menuItems.productId, products.id))
      .where(and(eq(menuItems.merchantId, table.merchantId), eq(menuItems.status, 'active')))
      .orderBy(asc(menuItems.sortOrder), asc(products.name))

    const rules = await db
      .select()
      .from(menuItemOutlets)
      .where(and(eq(menuItemOutlets.merchantId, table.merchantId), eq(menuItemOutlets.outletId, table.outletId)))

    const ruleByItem = new Map(rules.map((r) => [r.menuItemId, r]))
    const items = menu
      .filter((m) => m.available && (ruleByItem.get(m.id)?.available ?? true))
      .map((m) => {
        const rule = ruleByItem.get(m.id)
        return {
          id: m.id,
          name: m.name,
          description: m.description,
          price: Number(m.price) + (rule ? Number(rule.priceAdjustment) : 0),
          taxRate: m.taxRate
        }
      })

    return ok({ table: { id: table.id, name: table.name, code: table.code, seats: table.seats }, outlet: { id: table.outletId, name: table.outletName }, items })
  }
}
