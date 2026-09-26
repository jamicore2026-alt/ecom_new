import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or } from 'drizzle-orm'
import type { DB } from '../../database/client'
import {
  kitchenStations,
  kitchenTickets,
  kitchenTicketItems,
  foodOrderItems,
  menuItems,
  orders,
  outlets,
  tables,
  tableSessions
} from '../../database/schema'
import { ok } from '../../shared/response'
import { parsePagination, makeMeta } from '../../shared/pagination'
import { badRequest, notFound, conflict } from '../../shared/errors'
import { isFoodOrderType } from '../../shared/order-state'
import { assertKotTransition, isKotStatus, isKitchenItemStatus } from '../../shared/kitchen-state'
import { assertInOutletScope, assertInOutletScopeOrShared, effectiveOutletIds, outletScopeError, type OutletScope } from '../../shared/outlet-scope'
import type { KotStatus, KitchenStationStatus, KitchenItemStatus } from '../../shared/types'

const DEFAULT_STATION = 'General'

const ageSec = (t: Date) => Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 1000))

const addMeta = (ticket: { receivedAt: Date; prepSlaMin: number; status: string }) => {
  const age = ageSec(ticket.receivedAt)
  const open = !['READY', 'CANCELLED'].includes(ticket.status)
  return { ageSec: age, delayed: open && age > ticket.prepSlaMin * 60 }
}

/* ------------------------------ stations ------------------------------ */

export class KitchenStationsService {
  static async list(db: DB, merchantId: string, query: { outletId?: string }, scope: OutletScope) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok([])
    // A station is visible when it belongs to one of the caller's outlets, or
    // when it is merchant-wide (outletId null, shared "General"-style station).
    const conds = [eq(kitchenStations.merchantId, merchantId), or(inArray(kitchenStations.outletId, scopedIds), isNull(kitchenStations.outletId))]
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(kitchenStations.outletId, query.outletId))
    }
    const rows = await db
      .select({
        id: kitchenStations.id,
        name: kitchenStations.name,
        outletId: kitchenStations.outletId,
        prepSlaMin: kitchenStations.prepSlaMin,
        sortOrder: kitchenStations.sortOrder,
        status: kitchenStations.status,
        createdAt: kitchenStations.createdAt
      })
      .from(kitchenStations)
      .where(and(...conds))
      .orderBy(asc(kitchenStations.sortOrder), asc(kitchenStations.name))
    return ok(rows)
  }

  static async get(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [row] = await db
      .select({
        id: kitchenStations.id,
        name: kitchenStations.name,
        outletId: kitchenStations.outletId,
        prepSlaMin: kitchenStations.prepSlaMin,
        sortOrder: kitchenStations.sortOrder,
        status: kitchenStations.status,
        createdAt: kitchenStations.createdAt
      })
      .from(kitchenStations)
      .where(and(eq(kitchenStations.id, id), eq(kitchenStations.merchantId, merchantId)))
    if (!row) throw notFound('STATION_NOT_FOUND', 'Kitchen station not found')
    assertInOutletScopeOrShared(scope, row.outletId)
    return ok(row)
  }

  static async create(db: DB, merchantId: string, input: { name: string; outletId?: string; prepSlaMin?: number; sortOrder?: number; status?: string }, scope: OutletScope) {
    if (input.outletId) assertInOutletScope(scope, input.outletId)
    const [dup] = await db.select().from(kitchenStations).where(and(eq(kitchenStations.merchantId, merchantId), eq(kitchenStations.name, input.name)))
    if (dup) throw conflict('STATION_EXISTS', `A station named "${input.name}" already exists`)
    if (input.outletId) {
      const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.outletId), eq(outlets.merchantId, merchantId)))
      if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')
    }
    const [row] = await db.insert(kitchenStations).values({
      merchantId,
      name: input.name,
      outletId: input.outletId ?? null,
      prepSlaMin: input.prepSlaMin ?? 10,
      sortOrder: input.sortOrder ?? 0,
      status: (input.status ?? 'active') as KitchenStationStatus
    }).returning()
    return ok(row)
  }

  static async update(db: DB, merchantId: string, id: string, input: { name?: string; outletId?: string; prepSlaMin?: number; sortOrder?: number; status?: string }, scope: OutletScope) {
    const [existing] = await db.select().from(kitchenStations).where(and(eq(kitchenStations.id, id), eq(kitchenStations.merchantId, merchantId)))
    if (!existing) throw notFound('STATION_NOT_FOUND', 'Kitchen station not found')
    assertInOutletScopeOrShared(scope, existing.outletId)
    if (input.outletId) assertInOutletScope(scope, input.outletId)
    if (input.name && input.name !== existing.name) {
      const [dup] = await db.select().from(kitchenStations).where(and(eq(kitchenStations.merchantId, merchantId), eq(kitchenStations.name, input.name)))
      if (dup) throw conflict('STATION_EXISTS', `A station named "${input.name}" already exists`)
    }
    const [updated] = await db.update(kitchenStations).set({
      name: input.name ?? existing.name,
      outletId: input.outletId !== undefined ? input.outletId : existing.outletId,
      prepSlaMin: input.prepSlaMin ?? existing.prepSlaMin,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      status: (input.status ?? existing.status) as KitchenStationStatus
    }).where(eq(kitchenStations.id, id)).returning()
    return ok(updated)
  }

  static async remove(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [existing] = await db.select().from(kitchenStations).where(and(eq(kitchenStations.id, id), eq(kitchenStations.merchantId, merchantId)))
    if (!existing) throw notFound('STATION_NOT_FOUND', 'Kitchen station not found')
    assertInOutletScopeOrShared(scope, existing.outletId)
    const open = await db.select({ id: kitchenTickets.id }).from(kitchenTickets).where(and(eq(kitchenTickets.stationId, id), notInArray(kitchenTickets.status, ['READY', 'CANCELLED'])))
    if (open.length > 0) throw conflict('STATION_BUSY', 'This station still has open tickets')
    await db.delete(kitchenStations).where(eq(kitchenStations.id, id))
    return ok({ id, deleted: true })
  }
}

/* ------------------------------ tickets (KOT) ------------------------------ */

export class KitchenTicketsService {
  /** Resolve/ensure a station for a menu item's routing name; falls back to a General station. */
  private static async resolveStations(db: DB, merchantId: string, names: Set<string>): Promise<Map<string, { id: string; prepSlaMin: number }>> {
    const want = names.size ? [...names] : [DEFAULT_STATION]
    if (!want.includes(DEFAULT_STATION)) want.push(DEFAULT_STATION)
    const rows = await db.select().from(kitchenStations).where(and(eq(kitchenStations.merchantId, merchantId), inArray(kitchenStations.name, want)))
    const byName = new Map<string, { id: string; prepSlaMin: number }>()
    for (const r of rows.filter((s) => s.status !== 'archived')) byName.set(r.name, { id: r.id, prepSlaMin: r.prepSlaMin })

    for (const n of want) {
      if (!byName.has(n)) {
        const [created] = await db.insert(kitchenStations).values({ merchantId, name: n, prepSlaMin: 10, sortOrder: 0, status: 'active' }).returning()
        byName.set(n, { id: created.id, prepSlaMin: created.prepSlaMin })
      }
    }
    return byName
  }

  /** Generate KOT tickets for a food order, routed by menu item kitchen station. Idempotent per (order, station). */
  static async generateForOrder(db: DB, merchantId: string, orderId: string, priority: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL', scope: OutletScope) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')
    if (!isFoodOrderType(order.orderType)) throw badRequest('NOT_FOOD_ORDER', 'Only food orders produce kitchen tickets')
    assertInOutletScope(scope, order.outletId)

    const items = await db
      .select({
        id: foodOrderItems.id,
        name: foodOrderItems.name,
        modifiers: foodOrderItems.modifiers,
        quantity: foodOrderItems.quantity,
        menuItemId: foodOrderItems.menuItemId,
        station: menuItems.kitchenStation,
        menuAvailable: menuItems.available,
        menuStatus: menuItems.status
      })
      .from(foodOrderItems)
      .leftJoin(menuItems, eq(foodOrderItems.menuItemId, menuItems.id))
      .where(eq(foodOrderItems.orderId, orderId))
    if (items.length === 0) throw badRequest('NO_ITEMS', 'This order has no food items to route')
    // Unavailable/archived menu items never reach the board — exclude with notice.
    const skippedUnavailable = items.filter((i) => i.menuItemId && (i.menuAvailable === false || (i.menuStatus && i.menuStatus !== 'active'))).map((i) => ({ orderItemId: i.id, name: i.name }))
    const routable = items.filter((i) => !skippedUnavailable.some((s) => s.orderItemId === i.id))
    if (routable.length === 0) throw badRequest('NO_AVAILABLE_ITEMS', 'All items on this order are currently unavailable')

    const stationsByName = await this.resolveStations(db, merchantId, new Set(routable.map((i) => (i.station || DEFAULT_STATION).trim() || DEFAULT_STATION)))
    const groups = new Map<string, typeof routable>()
    for (const item of routable) {
      const key = (item.station || DEFAULT_STATION).trim() || DEFAULT_STATION
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(item)
    }

    const created: { id: string }[] = []
    await db.transaction(async (tx) => {
      for (const [stationName, groupItems] of groups) {
        const station = stationsByName.get(stationName)!
        const [ticket] = await tx
          .insert(kitchenTickets)
          .values({
            merchantId,
            outletId: order.outletId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            stationId: station.id,
            stationName,
            sourceType: order.orderType,
            status: 'NEW',
            priority,
            prepSlaMin: station.prepSlaMin,
            dueAt: order.scheduledFor ?? null
          })
          .onConflictDoNothing({ target: [kitchenTickets.orderId, kitchenTickets.stationId] })
          .returning()
        if (!ticket) continue
        created.push(ticket)
        await tx.insert(kitchenTicketItems).values(
          groupItems.map((i) => ({
            merchantId,
            ticketId: ticket.id,
            orderItemId: i.id,
            menuItemId: i.menuItemId,
            name: i.name,
            modifiers: i.modifiers,
            quantity: i.quantity,
            status: 'PENDING' as KitchenItemStatus
          }))
        )
      }
    })

    const listed = await this.list(db, merchantId, { orderId }, scope)
    const data = listed.data as unknown as { items: unknown; meta: unknown }
    return ok({ items: data.items, meta: data.meta, skippedUnavailable })
  }

  static async list(db: DB, merchantId: string, query: { outletId?: string; stationId?: string; status?: string; search?: string; orderId?: string; page?: number; limit?: number }, scope: OutletScope) {
    const { page, limit, offset } = parsePagination(query)
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok({ items: [], meta: makeMeta(page, limit, 0) })
    const conds = [eq(kitchenTickets.merchantId, merchantId), inArray(kitchenTickets.outletId, scopedIds)]
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(kitchenTickets.outletId, query.outletId))
    }
    if (query.stationId) conds.push(eq(kitchenTickets.stationId, query.stationId))
    if (query.status) {
      if (!isKotStatus(query.status)) throw badRequest('INVALID_KOT_STATUS', 'Unknown KOT status')
      conds.push(eq(kitchenTickets.status, query.status))
    }
    if (query.orderId) conds.push(eq(kitchenTickets.orderId, query.orderId))
    if (query.search) conds.push(ilike(kitchenTickets.orderNumber, `%${query.search.trim()}%`))

    const where = and(...conds)
    const [{ value: total }] = await db.select({ value: count() }).from(kitchenTickets).where(where)
    const rows = await db
      .select({
        id: kitchenTickets.id,
        orderId: kitchenTickets.orderId,
        orderNumber: kitchenTickets.orderNumber,
        outletId: kitchenTickets.outletId,
        outletName: outlets.name,
        stationId: kitchenTickets.stationId,
        stationName: kitchenTickets.stationName,
        sourceType: kitchenTickets.sourceType,
        status: kitchenTickets.status,
        priority: kitchenTickets.priority,
        prepSlaMin: kitchenTickets.prepSlaMin,
        dueAt: kitchenTickets.dueAt,
        receivedAt: kitchenTickets.receivedAt,
        startedAt: kitchenTickets.startedAt,
        readyAt: kitchenTickets.readyAt,
        itemCount: count(kitchenTicketItems.id)
      })
      .from(kitchenTickets)
      .leftJoin(outlets, eq(kitchenTickets.outletId, outlets.id))
      .leftJoin(kitchenTicketItems, eq(kitchenTicketItems.ticketId, kitchenTickets.id))
      .where(where)
      .groupBy(
        kitchenTickets.id,
        outlets.name
      )
      .orderBy(desc(kitchenTickets.priority), asc(kitchenTickets.receivedAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows.map((r) => ({ ...r, ...addMeta(r) })), meta: makeMeta(page, limit, total) })
  }

  static async get(db: DB, merchantId: string, id: string, scope: OutletScope) {
    const [ticket] = await db
      .select({
        id: kitchenTickets.id,
        orderId: kitchenTickets.orderId,
        orderNumber: kitchenTickets.orderNumber,
        outletId: kitchenTickets.outletId,
        stationId: kitchenTickets.stationId,
        stationName: kitchenTickets.stationName,
        sourceType: kitchenTickets.sourceType,
        status: kitchenTickets.status,
        priority: kitchenTickets.priority,
        prepSlaMin: kitchenTickets.prepSlaMin,
        dueAt: kitchenTickets.dueAt,
        receivedAt: kitchenTickets.receivedAt,
        startedAt: kitchenTickets.startedAt,
        readyAt: kitchenTickets.readyAt,
        tableName: tables.name
      })
      .from(kitchenTickets)
      .leftJoin(orders, eq(kitchenTickets.orderId, orders.id))
      .leftJoin(tableSessions, eq(orders.tableSessionId, tableSessions.id))
      .leftJoin(tables, eq(tableSessions.tableId, tables.id))
      .where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Kitchen ticket not found')
    assertInOutletScope(scope, ticket.outletId)

    const items = await db
      .select({
        id: kitchenTicketItems.id,
        ticketId: kitchenTicketItems.ticketId,
        orderItemId: kitchenTicketItems.orderItemId,
        menuItemId: kitchenTicketItems.menuItemId,
        name: kitchenTicketItems.name,
        modifiers: kitchenTicketItems.modifiers,
        quantity: kitchenTicketItems.quantity,
        status: kitchenTicketItems.status,
        readyAt: kitchenTicketItems.readyAt,
        createdAt: kitchenTicketItems.createdAt,
        fireAt: foodOrderItems.fireAt,
        allergens: menuItems.allergens
      })
      .from(kitchenTicketItems)
      .leftJoin(foodOrderItems, eq(kitchenTicketItems.orderItemId, foodOrderItems.id))
      .leftJoin(menuItems, eq(kitchenTicketItems.menuItemId, menuItems.id))
      .where(eq(kitchenTicketItems.ticketId, id))
      .orderBy(asc(kitchenTicketItems.createdAt))

    return ok({ ...ticket, ...addMeta(ticket), items: items.map((i) => ({ ...i, allergens: (i.allergens ?? []) as string[], fireAt: i.fireAt ?? null })) })
  }

  private static async setTimestamps(db: DB, merchantId: string, id: string, status: KotStatus) {
    if (status === 'PREPARING') return db.update(kitchenTickets).set({ startedAt: new Date() }).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (status === 'READY') return db.update(kitchenTickets).set({ readyAt: new Date(), closedAt: new Date() }).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (status === 'CANCELLED') return db.update(kitchenTickets).set({ closedAt: new Date() }).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    return Promise.resolve()
  }

  static async transition(db: DB, merchantId: string, id: string, nextStatus: string, scope: OutletScope) {
    const [ticket] = await db.select().from(kitchenTickets).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Kitchen ticket not found')
    assertInOutletScope(scope, ticket.outletId)
    if (!isKotStatus(nextStatus)) throw badRequest('INVALID_KOT_STATUS', 'Unknown KOT status')
    assertKotTransition(ticket.status, nextStatus)

    await db.transaction(async (tx) => {
      await tx.update(kitchenTickets).set({ status: nextStatus, closedAt: nextStatus === 'CANCELLED' ? new Date() : ticket.closedAt, readyAt: nextStatus === 'READY' ? new Date() : ticket.readyAt, startedAt: nextStatus === 'PREPARING' ? new Date() : ticket.startedAt }).where(eq(kitchenTickets.id, id))
      if (nextStatus === 'READY') {
        await tx.update(kitchenTicketItems).set({ status: 'READY', readyAt: new Date() }).where(and(eq(kitchenTicketItems.ticketId, id), eq(kitchenTicketItems.status, 'PENDING')))
      }
    })
    return this.get(db, merchantId, id, scope)
  }

  static async bump(db: DB, merchantId: string, id: string, scope: OutletScope) {
    return this.transition(db, merchantId, id, 'READY', scope)
  }

  static async recall(db: DB, merchantId: string, id: string, scope: OutletScope) {
    return this.transition(db, merchantId, id, 'RECALLED', scope)
  }

  static async setPriority(db: DB, merchantId: string, id: string, priority: 'LOW' | 'NORMAL' | 'HIGH', scope: OutletScope) {
    const [ticket] = await db.select().from(kitchenTickets).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Kitchen ticket not found')
    assertInOutletScope(scope, ticket.outletId)
    const [updated] = await db.update(kitchenTickets).set({ priority }).where(eq(kitchenTickets.id, id)).returning()
    return ok(updated)
  }

  /** Item-level completion: picking items READY/DONE can bump the whole ticket when all lines are done. */
  static async itemStatus(db: DB, merchantId: string, id: string, itemId: string, status: string, scope: OutletScope) {
    const [ticket] = await db.select().from(kitchenTickets).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Kitchen ticket not found')
    assertInOutletScope(scope, ticket.outletId)
    if (!isKitchenItemStatus(status)) throw badRequest('INVALID_ITEM_STATUS', 'Unknown item status')
    if (status === 'CANCELLED' && ['READY', 'CANCELLED'].includes(ticket.status)) {
      throw conflict('TICKET_CLOSED', 'Cannot edit a closed ticket')
    }

    const [item] = await db.select().from(kitchenTicketItems).where(and(eq(kitchenTicketItems.id, itemId), eq(kitchenTicketItems.ticketId, id)))
    if (!item) throw notFound('ITEM_NOT_FOUND', 'Ticket item not found')

    await db.update(kitchenTicketItems).set({
      status,
      readyAt: status === 'READY' || status === 'DONE' ? new Date() : null
    }).where(eq(kitchenTicketItems.id, itemId))

    if (status === 'READY' || status === 'DONE') {
      const lines = await db.select({ status: kitchenTicketItems.status }).from(kitchenTicketItems).where(eq(kitchenTicketItems.ticketId, id))
      const remaining = lines.filter((l) => l.status !== 'DONE' && l.status !== 'CANCELLED')
      if (remaining.length === 0 && !['READY', 'CANCELLED'].includes(ticket.status)) {
        await this.transition(db, merchantId, id, 'READY', scope)
      }
    }
    return this.get(db, merchantId, id, scope)
  }
}

/* ------------------------------ hold-and-fire ------------------------------ */

export class HoldFireService {
  /** Set (or clear with null) fireAt on a food-order line. Held lines hide from KDS until fireAt passes. */
  static async setHold(db: DB, merchantId: string, orderItemId: string, fireAt: string | null, scope: OutletScope) {
    const [line] = await db.select().from(foodOrderItems).where(and(eq(foodOrderItems.id, orderItemId), eq(foodOrderItems.merchantId, merchantId)))
    if (!line) throw notFound('ORDER_ITEM_NOT_FOUND', 'Order line not found')
    const [order] = await db.select().from(orders).where(and(eq(orders.id, line.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')
    assertInOutletScope(scope, order.outletId)
    let fire: Date | null = null
    if (fireAt !== null && fireAt !== undefined) {
      fire = new Date(fireAt)
      if (Number.isNaN(fire.getTime())) throw badRequest('INVALID_FIRE_AT', 'fireAt must be an ISO datetime or null')
    }
    const [updated] = await db.update(foodOrderItems).set({ fireAt: fire }).where(eq(foodOrderItems.id, orderItemId)).returning()
    return ok(updated)
  }

  static async fireNow(db: DB, merchantId: string, orderItemId: string, scope: OutletScope) {
    return this.setHold(db, merchantId, orderItemId, null, scope)
  }
}

/* ------------------------------ station metrics ------------------------------ */

export class KitchenMetricsService {
  /** Per-station performance: avg prep minutes (received→ready), delayed count, ready count. */
  static async stationMetrics(db: DB, merchantId: string, query: { outletId?: string }, scope: OutletScope) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok([])
    const conds = [eq(kitchenTickets.merchantId, merchantId), inArray(kitchenTickets.outletId, scopedIds)]
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(kitchenTickets.outletId, query.outletId))
    }
    const tickets = await db
      .select({
        stationId: kitchenTickets.stationId,
        stationName: kitchenTickets.stationName,
        status: kitchenTickets.status,
        prepSlaMin: kitchenTickets.prepSlaMin,
        receivedAt: kitchenTickets.receivedAt,
        readyAt: kitchenTickets.readyAt
      })
      .from(kitchenTickets)
      .where(and(...conds))
    const byStation = new Map<string, { stationId: string; stationName: string; prepMins: number[]; delayed: number; open: number; ready: number }>()
    for (const t of tickets) {
      if (!byStation.has(t.stationId)) byStation.set(t.stationId, { stationId: t.stationId, stationName: t.stationName, prepMins: [], delayed: 0, open: 0, ready: 0 })
      const agg = byStation.get(t.stationId)!
      const open = !['READY', 'CANCELLED'].includes(t.status)
      if (open) {
        agg.open += 1
        if (ageSec(new Date(t.receivedAt)) > t.prepSlaMin * 60) agg.delayed += 1
      } else if (t.status === 'READY' && t.readyAt) {
        agg.ready += 1
        const mins = (new Date(t.readyAt).getTime() - new Date(t.receivedAt).getTime()) / 60000
        if (Number.isFinite(mins) && mins >= 0) agg.prepMins.push(mins)
        if (mins > t.prepSlaMin) agg.delayed += 1
      }
    }
    const rows = [...byStation.values()].map((a) => ({
      stationId: a.stationId,
      stationName: a.stationName,
      readyCount: a.ready,
      openCount: a.open,
      delayedCount: a.delayed,
      avgPrepMin: a.prepMins.length ? Math.round((a.prepMins.reduce((x, y) => x + y, 0) / a.prepMins.length) * 10) / 10 : null
    }))
    return ok(rows)
  }
}

/* ------------------------------ KDS board ------------------------------ */

export class KdsBoardService {
  /** Group open (and ready) tickets by station — the KDS display model. */
  static async board(db: DB, merchantId: string, query: { outletId?: string; stationId?: string }, scope: OutletScope) {
    const scopedIds = effectiveOutletIds(scope)
    if (scopedIds === null) return ok({ stations: [], delayedCount: 0 })
    const conds = [eq(kitchenTickets.merchantId, merchantId), notInArray(kitchenTickets.status, ['CANCELLED']), inArray(kitchenTickets.outletId, scopedIds)]
    if (query.outletId) {
      if (!scopedIds.includes(query.outletId)) throw outletScopeError('This outlet is outside your scope')
      conds.push(eq(kitchenTickets.outletId, query.outletId))
    }
    if (query.stationId) conds.push(eq(kitchenTickets.stationId, query.stationId))

    const stations = query.stationId
      ? await db.select().from(kitchenStations).where(and(eq(kitchenStations.merchantId, merchantId), eq(kitchenStations.id, query.stationId)))
      : await db.select().from(kitchenStations).where(and(eq(kitchenStations.merchantId, merchantId), notInArray(kitchenStations.status, ['archived']), or(inArray(kitchenStations.outletId, scopedIds), isNull(kitchenStations.outletId)))).orderBy(asc(kitchenStations.sortOrder))

    const tickets = await db
      .select({
        id: kitchenTickets.id,
        orderNumber: kitchenTickets.orderNumber,
        stationId: kitchenTickets.stationId,
        stationName: kitchenTickets.stationName,
        sourceType: kitchenTickets.sourceType,
        status: kitchenTickets.status,
        priority: kitchenTickets.priority,
        prepSlaMin: kitchenTickets.prepSlaMin,
        receivedAt: kitchenTickets.receivedAt,
        startedAt: kitchenTickets.startedAt,
        dueAt: kitchenTickets.dueAt,
        readyAt: kitchenTickets.readyAt,
        tableName: tables.name
      })
      .from(kitchenTickets)
      .leftJoin(orders, eq(kitchenTickets.orderId, orders.id))
      .leftJoin(tableSessions, eq(orders.tableSessionId, tableSessions.id))
      .leftJoin(tables, eq(tableSessions.tableId, tables.id))
      .where(and(...conds))
      .orderBy(desc(kitchenTickets.priority), asc(kitchenTickets.receivedAt))

    const ticketIds = tickets.map((t) => t.id)
    // Enrich lines with hold/fire state + menu allergens/availability so the
    // board can hide held lines and badge allergens without extra round-trips.
    const items = ticketIds.length
      ? await db
        .select({
          id: kitchenTicketItems.id,
          ticketId: kitchenTicketItems.ticketId,
          orderItemId: kitchenTicketItems.orderItemId,
          menuItemId: kitchenTicketItems.menuItemId,
          name: kitchenTicketItems.name,
          modifiers: kitchenTicketItems.modifiers,
          quantity: kitchenTicketItems.quantity,
          status: kitchenTicketItems.status,
          readyAt: kitchenTicketItems.readyAt,
          createdAt: kitchenTicketItems.createdAt,
          fireAt: foodOrderItems.fireAt,
          allergens: menuItems.allergens,
          menuAvailable: menuItems.available,
          menuStatus: menuItems.status
        })
        .from(kitchenTicketItems)
        .leftJoin(foodOrderItems, eq(kitchenTicketItems.orderItemId, foodOrderItems.id))
        .leftJoin(menuItems, eq(kitchenTicketItems.menuItemId, menuItems.id))
        .where(inArray(kitchenTicketItems.ticketId, ticketIds))
        .orderBy(asc(kitchenTicketItems.createdAt))
      : []
    const now = Date.now()
    let heldCount = 0
    let unavailableCount = 0
    const itemsByTicket = new Map<string, typeof items>()
    for (const it of items) {
      // Hold-and-fire: hidden from KDS until fireAt passes.
      if (it.fireAt && new Date(it.fireAt).getTime() > now) {
        heldCount += 1
        continue
      }
      // Unavailable/archived menu items are excluded from the board.
      if (it.menuItemId && (it.menuAvailable === false || (it.menuStatus && it.menuStatus !== 'active'))) {
        unavailableCount += 1
        continue
      }
      if (!itemsByTicket.has(it.ticketId)) itemsByTicket.set(it.ticketId, [])
      itemsByTicket.get(it.ticketId)!.push({
        ...it,
        allergens: (it.allergens ?? []) as string[],
        fireAt: it.fireAt ?? null
      })
    }

    const board = stations.map((s) => ({
      id: s.id,
      name: s.name,
      prepSlaMin: s.prepSlaMin,
      tickets: tickets
        .filter((t) => t.stationId === s.id)
        .map((t) => ({ ...t, ...addMeta(t), items: itemsByTicket.get(t.id) ?? [] }))
    }))

    return ok({
      stations: board,
      delayedCount: tickets.filter((t) => addMeta(t).delayed).length,
      heldCount,
      unavailableCount,
      unavailableNotice: unavailableCount > 0 ? `${unavailableCount} unavailable item(s) hidden from the board` : null
    })
  }
}
