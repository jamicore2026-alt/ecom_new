import { and, asc, count, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { outlets, tableSections, tables, tableSessions, orders, foodOrderItems, menuItems, products, menuItemOutlets, reservations } from '../../database/schema'
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
        posX: tables.posX,
        posY: tables.posY,
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
        posX: tables.posX,
        posY: tables.posY,
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

  static async update(db: DB, merchantId: string, id: string, input: { sectionId?: string; name?: string; code?: string; seats?: number; posX?: number | null; posY?: number | null }, scope: OutletScope) {
    const [existing] = await db.select().from(tables).where(and(eq(tables.id, id), eq(tables.merchantId, merchantId)))
    if (!existing) throw notFound('TABLE_NOT_FOUND', 'Table not found')
    assertInOutletScope(scope, existing.outletId)
    if (input.sectionId) {
      const [sec] = await db.select().from(tableSections).where(and(eq(tableSections.id, input.sectionId), eq(tableSections.merchantId, merchantId)))
      if (!sec) throw notFound('SECTION_NOT_FOUND', 'Table section not found')
    }
    for (const k of ['posX', 'posY'] as const) {
      const v = input[k]
      if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0 || v > 100)) {
        throw badRequest('INVALID_POSITION', `${k} must be an integer percent between 0 and 100`)
      }
    }
    const [updated] = await db.update(tables).set({
      sectionId: input.sectionId !== undefined ? input.sectionId : existing.sectionId,
      name: input.name ?? existing.name,
      code: input.code ?? existing.code,
      seats: input.seats ?? existing.seats,
      posX: input.posX !== undefined ? input.posX : existing.posX,
      posY: input.posY !== undefined ? input.posY : existing.posY
    }).where(eq(tables.id, id)).returning()
    return ok(updated)
  }

  /** Floor-editor drag-drop: persist canvas percent position (0-100). */
  static async setPosition(db: DB, merchantId: string, id: string, posX: number | null, posY: number | null, scope: OutletScope) {
    return this.update(db, merchantId, id, { posX, posY }, scope)
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
    if (baseUrl !== undefined) {
      // The base URL is embedded in the rendered QR payload — only allow
      // absolute http(s) URLs so javascript:/data: payloads can never be minted.
      let parsed: URL
      try {
        parsed = new URL(baseUrl)
      } catch {
        throw badRequest('INVALID_BASE_URL', 'baseUrl must be an absolute http(s) URL')
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw badRequest('INVALID_BASE_URL', 'baseUrl must be an absolute http(s) URL')
      }
    }
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

  /**
   * Split a party: move `guests` from this OPEN session into a new session on
   * `toTableId`. When `orderItemIds` is provided, those food-order lines move
   * to a new order attached to the split session (totals recomputed); the
   * guest count moves regardless.
   */
  static async split(db: DB, merchantId: string, id: string, toTableId: string, guests: number, scope: OutletScope, orderItemIds?: string[]) {
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

    const moveLines = [...new Set(orderItemIds ?? [])]
    if (moveLines.length > 0) {
      const lines = await db.select().from(foodOrderItems).where(and(eq(foodOrderItems.merchantId, merchantId), inArray(foodOrderItems.id, moveLines)))
      if (lines.length !== moveLines.length) throw notFound('ORDER_ITEM_NOT_FOUND', 'One or more order lines were not found')
      const orderIds = [...new Set(lines.map((l) => l.orderId))]
      const linked = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.merchantId, merchantId), inArray(orders.id, orderIds), eq(orders.tableSessionId, id)))
      if (linked.length !== orderIds.length) throw badRequest('LINES_NOT_ON_SESSION', 'All moved lines must belong to orders on this session')
    }

    const round2 = (n: number) => Math.round(n * 100) / 100
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
      if (moveLines.length > 0) {
        const [probe] = await tx.select().from(foodOrderItems).where(eq(foodOrderItems.id, moveLines[0]))
        const [srcOrder] = await tx.select().from(orders).where(eq(orders.id, probe!.orderId))
        const [splitOrder] = await tx.insert(orders).values({
          merchantId,
          outletId: toTable.outletId,
          orderNumber: `#F${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
          orderType: srcOrder!.orderType,
          status: srcOrder!.status,
          paymentStatus: 'unpaid',
          fulfillmentStatus: 'unfulfilled',
          tableSessionId: s.id,
          subtotal: 0,
          taxTotal: 0,
          total: 0,
          currency: srcOrder!.currency,
          notes: `Split from ${session.id}`
        }).returning()
        await tx.update(foodOrderItems).set({ orderId: splitOrder.id }).where(inArray(foodOrderItems.id, moveLines))
        // Recompute totals on both sides from remaining lines.
        for (const oid of [splitOrder.id, srcOrder!.id]) {
          const remaining = await tx.select().from(foodOrderItems).where(eq(foodOrderItems.orderId, oid))
          const subtotal = round2(remaining.reduce((a, l) => a + Number(l.total), 0))
          await tx.update(orders).set({ subtotal, total: subtotal }).where(eq(orders.id, oid))
        }
      }
      return [s]
    })
    const origin = await this.get(db, merchantId, id, scope)
    const arrived = await this.get(db, merchantId, newSession.id, scope)
    return ok({ session: origin.data, splitInto: arrived.data, movedLines: moveLines.length })
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

/* ------------------------------ reservations + waitlist ------------------------------ */

const RESERVATION_STATUSES = ['booked', 'seated', 'cancelled', 'no-show', 'waitlist'] as const

export class ReservationsService {
  private static assertStatus(status: string) {
    if (!(RESERVATION_STATUSES as readonly string[]).includes(status)) {
      throw badRequest('INVALID_RESERVATION_STATUS', `Unknown reservation status: ${status}`)
    }
  }

  static async list(db: DB, merchantId: string, query: { outletId?: string; status?: string; from?: string; to?: string }, scope: OutletScope) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok([])
    const conds = [eq(reservations.merchantId, merchantId), inArray(reservations.outletId, scopedIds)]
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(reservations.outletId, query.outletId))
    }
    if (query.status) {
      this.assertStatus(query.status)
      conds.push(eq(reservations.status, query.status))
    }
    if (query.from) conds.push(gte(reservations.reservedAt, new Date(query.from)))
    if (query.to) conds.push(lte(reservations.reservedAt, new Date(query.to)))
    const rows = await db
      .select({
        id: reservations.id,
        outletId: reservations.outletId,
        outletName: outlets.name,
        tableId: reservations.tableId,
        tableName: tables.name,
        guestName: reservations.guestName,
        guestPhone: reservations.guestPhone,
        partySize: reservations.partySize,
        reservedAt: reservations.reservedAt,
        status: reservations.status,
        notes: reservations.notes,
        createdAt: reservations.createdAt
      })
      .from(reservations)
      .leftJoin(outlets, eq(reservations.outletId, outlets.id))
      .leftJoin(tables, eq(reservations.tableId, tables.id))
      .where(and(...conds))
      .orderBy(asc(reservations.reservedAt))
    return ok(rows)
  }

  static async waitlist(db: DB, merchantId: string, query: { outletId?: string }, scope: OutletScope) {
    return this.list(db, merchantId, { ...query, status: 'waitlist' }, scope).then(async (res) => {
      const rows = (res.data as unknown[]) ?? []
      // FIFO: oldest request first.
      rows.sort((a, b) => new Date((a as { createdAt: string }).createdAt).getTime() - new Date((b as { createdAt: string }).createdAt).getTime())
      return ok(rows)
    })
  }

  static async history(db: DB, merchantId: string, phone: string, scope: OutletScope) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok({ count: 0, reservations: [] })
    const rows = await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.merchantId, merchantId), eq(reservations.guestPhone, phone.trim()), inArray(reservations.outletId, scopedIds)))
      .orderBy(desc(reservations.reservedAt))
    return ok({ count: rows.length, reservations: rows })
  }

  static async get(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [row] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.merchantId, merchantId)))
    if (!row) throw notFound('RESERVATION_NOT_FOUND', 'Reservation not found')
    assertInOutletScope(scope, row.outletId)
    return ok(row)
  }

  static async create(db: DB, merchantId: string, input: { outletId: string; tableId?: string; guestName: string; guestPhone?: string; partySize?: number; reservedAt: string; status?: string; notes?: string }, scope: OutletScope) {
    assertInOutletScope(scope, input.outletId)
    const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.outletId), eq(outlets.merchantId, merchantId)))
    if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')
    if (input.tableId) {
      const [table] = await db.select().from(tables).where(and(eq(tables.id, input.tableId), eq(tables.merchantId, merchantId)))
      if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found')
      if (table.outletId !== input.outletId) throw badRequest('TABLE_OUTLET_MISMATCH', 'Table belongs to a different outlet')
    }
    const status = input.status ?? 'booked'
    this.assertStatus(status)
    const at = new Date(input.reservedAt)
    if (Number.isNaN(at.getTime())) throw badRequest('INVALID_RESERVED_AT', 'reservedAt must be an ISO datetime')
    const [row] = await db.insert(reservations).values({
      merchantId,
      outletId: input.outletId,
      tableId: input.tableId ?? null,
      guestName: input.guestName,
      guestPhone: input.guestPhone ?? null,
      partySize: input.partySize ?? 2,
      reservedAt: at,
      status,
      notes: input.notes ?? null
    }).returning()
    return ok(row)
  }

  static async update(db: DB, merchantId: string, id: string, input: { guestName?: string; guestPhone?: string; partySize?: number; reservedAt?: string; notes?: string }, scope: OutletScope) {
    const [existing] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.merchantId, merchantId)))
    if (!existing) throw notFound('RESERVATION_NOT_FOUND', 'Reservation not found')
    assertInOutletScope(scope, existing.outletId)
    const set: Record<string, unknown> = {}
    if (input.guestName !== undefined) set.guestName = input.guestName
    if (input.guestPhone !== undefined) set.guestPhone = input.guestPhone
    if (input.partySize !== undefined) set.partySize = input.partySize
    if (input.notes !== undefined) set.notes = input.notes
    if (input.reservedAt !== undefined) {
      const at = new Date(input.reservedAt)
      if (Number.isNaN(at.getTime())) throw badRequest('INVALID_RESERVED_AT', 'reservedAt must be an ISO datetime')
      set.reservedAt = at
    }
    const [row] = await db.update(reservations).set(set).where(eq(reservations.id, id)).returning()
    return ok(row)
  }

  static async setStatus(db: DB, merchantId: string, id: string, status: string, scope: OutletScope) {
    this.assertStatus(status)
    const [existing] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.merchantId, merchantId)))
    if (!existing) throw notFound('RESERVATION_NOT_FOUND', 'Reservation not found')
    assertInOutletScope(scope, existing.outletId)
    const [row] = await db.update(reservations).set({ status }).where(eq(reservations.id, id)).returning()
    return ok(row)
  }

  /** Assign a table to a reservation (validates same outlet + table state). */
  static async assignTable(db: DB, merchantId: string, id: string, tableId: string, scope: OutletScope) {
    const [existing] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.merchantId, merchantId)))
    if (!existing) throw notFound('RESERVATION_NOT_FOUND', 'Reservation not found')
    assertInOutletScope(scope, existing.outletId)
    if (['cancelled', 'no-show'].includes(existing.status)) throw conflict('RESERVATION_CLOSED', `Cannot assign a table to a ${existing.status} reservation`)
    const [table] = await db.select().from(tables).where(and(eq(tables.id, tableId), eq(tables.merchantId, merchantId)))
    if (!table) throw notFound('TABLE_NOT_FOUND', 'Table not found')
    assertInOutletScope(scope, table.outletId)
    if (table.outletId !== existing.outletId) throw badRequest('TABLE_OUTLET_MISMATCH', 'Table belongs to a different outlet')
    const [row] = await db.update(reservations).set({ tableId: table.id }).where(eq(reservations.id, id)).returning()
    return ok(row)
  }

  static async remove(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [existing] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.merchantId, merchantId)))
    if (!existing) throw notFound('RESERVATION_NOT_FOUND', 'Reservation not found')
    assertInOutletScope(scope, existing.outletId)
    await db.delete(reservations).where(eq(reservations.id, id))
    return ok({ id, deleted: true })
  }
}

/* ------------------------------ turn-time report ------------------------------ */

export class TurnTimeService {
  /** Avg/median open→close minutes per outlet/section (closed sessions only). */
  static async report(db: DB, merchantId: string, query: { outletId?: string }, scope: OutletScope) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok([])
    const conds = [eq(tableSessions.merchantId, merchantId), eq(tableSessions.status, 'CLOSED'), inArray(tableSessions.outletId, scopedIds)]
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(tableSessions.outletId, query.outletId))
    }
    const rows = await db
      .select({
        outletId: tableSessions.outletId,
        outletName: outlets.name,
        sectionId: tables.sectionId,
        sectionName: tableSections.name,
        openedAt: tableSessions.openedAt,
        closedAt: tableSessions.closedAt
      })
      .from(tableSessions)
      .leftJoin(outlets, eq(tableSessions.outletId, outlets.id))
      .leftJoin(tables, eq(tableSessions.tableId, tables.id))
      .leftJoin(tableSections, eq(tables.sectionId, tableSections.id))
      .where(and(...conds))
    const groups = new Map<string, { outletId: string | null; outletName: string | null; sectionId: string | null; sectionName: string | null; mins: number[] }>()
    for (const r of rows) {
      if (!r.openedAt || !r.closedAt) continue
      const mins = (new Date(r.closedAt).getTime() - new Date(r.openedAt).getTime()) / 60000
      if (!Number.isFinite(mins) || mins < 0) continue
      const key = `${r.outletId ?? 'none'}::${r.sectionId ?? 'none'}`
      if (!groups.has(key)) groups.set(key, { outletId: r.outletId, outletName: r.outletName, sectionId: r.sectionId, sectionName: r.sectionName, mins: [] })
      groups.get(key)!.mins.push(mins)
    }
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b)
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    const out = [...groups.values()].map((g) => ({
      outletId: g.outletId,
      outletName: g.outletName,
      sectionId: g.sectionId,
      sectionName: g.sectionName,
      sessions: g.mins.length,
      avgMin: Math.round((g.mins.reduce((a, b) => a + b, 0) / g.mins.length) * 10) / 10,
      medianMin: Math.round(median(g.mins) * 10) / 10
    }))
    return ok(out)
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
