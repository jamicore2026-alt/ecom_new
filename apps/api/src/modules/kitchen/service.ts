import { and, asc, count, desc, eq, inArray, notInArray } from 'drizzle-orm'
import { db } from '../../database/client'
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
  static async list(merchantId: string, query: { outletId?: string }) {
    const conds = [eq(kitchenStations.merchantId, merchantId)]
    if (query.outletId) conds.push(eq(kitchenStations.outletId, query.outletId))
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

  static async get(merchantId: string, id: string) {
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
    return ok(row)
  }

  static async create(merchantId: string, input: { name: string; outletId?: string; prepSlaMin?: number; sortOrder?: number; status?: string }) {
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

  static async update(merchantId: string, id: string, input: { name?: string; outletId?: string; prepSlaMin?: number; sortOrder?: number; status?: string }) {
    const [existing] = await db.select().from(kitchenStations).where(and(eq(kitchenStations.id, id), eq(kitchenStations.merchantId, merchantId)))
    if (!existing) throw notFound('STATION_NOT_FOUND', 'Kitchen station not found')
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

  static async remove(merchantId: string, id: string) {
    const [existing] = await db.select().from(kitchenStations).where(and(eq(kitchenStations.id, id), eq(kitchenStations.merchantId, merchantId)))
    if (!existing) throw notFound('STATION_NOT_FOUND', 'Kitchen station not found')
    const open = await db.select({ id: kitchenTickets.id }).from(kitchenTickets).where(and(eq(kitchenTickets.stationId, id), notInArray(kitchenTickets.status, ['READY', 'CANCELLED'])))
    if (open.length > 0) throw conflict('STATION_BUSY', 'This station still has open tickets')
    await db.delete(kitchenStations).where(eq(kitchenStations.id, id))
    return ok({ id, deleted: true })
  }
}

/* ------------------------------ tickets (KOT) ------------------------------ */

export class KitchenTicketsService {
  /** Resolve/ensure a station for a menu item's routing name; falls back to a General station. */
  private static async resolveStations(merchantId: string, names: Set<string>): Promise<Map<string, { id: string; prepSlaMin: number }>> {
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
  static async generateForOrder(merchantId: string, orderId: string, priority: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL') {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')
    if (!isFoodOrderType(order.orderType)) throw badRequest('NOT_FOOD_ORDER', 'Only food orders produce kitchen tickets')

    const items = await db
      .select({
        id: foodOrderItems.id,
        name: foodOrderItems.name,
        modifiers: foodOrderItems.modifiers,
        quantity: foodOrderItems.quantity,
        menuItemId: foodOrderItems.menuItemId,
        station: menuItems.kitchenStation
      })
      .from(foodOrderItems)
      .leftJoin(menuItems, eq(foodOrderItems.menuItemId, menuItems.id))
      .where(eq(foodOrderItems.orderId, orderId))
    if (items.length === 0) throw badRequest('NO_ITEMS', 'This order has no food items to route')

    const stationsByName = await this.resolveStations(merchantId, new Set(items.map((i) => (i.station || DEFAULT_STATION).trim() || DEFAULT_STATION)))
    const groups = new Map<string, typeof items>()
    for (const item of items) {
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

    return this.list(merchantId, { orderId })
  }

  static async list(merchantId: string, query: { outletId?: string; stationId?: string; status?: string; search?: string; orderId?: string; page?: number; limit?: number }) {
    const { page, limit, offset } = parsePagination(query)
    const conds = [eq(kitchenTickets.merchantId, merchantId)]
    if (query.outletId) conds.push(eq(kitchenTickets.outletId, query.outletId))
    if (query.stationId) conds.push(eq(kitchenTickets.stationId, query.stationId))
    if (query.status) {
      if (!isKotStatus(query.status)) throw badRequest('INVALID_KOT_STATUS', 'Unknown KOT status')
      conds.push(eq(kitchenTickets.status, query.status))
    }
    if (query.orderId) conds.push(eq(kitchenTickets.orderId, query.orderId))
    if (query.search) conds.push(eq(kitchenTickets.orderNumber, query.search.trim()))

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

  static async get(merchantId: string, id: string) {
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

    const items = await db
      .select()
      .from(kitchenTicketItems)
      .where(eq(kitchenTicketItems.ticketId, id))
      .orderBy(asc(kitchenTicketItems.createdAt))

    return ok({ ...ticket, ...addMeta(ticket), items })
  }

  private static async setTimestamps(merchantId: string, id: string, status: KotStatus) {
    if (status === 'PREPARING') return db.update(kitchenTickets).set({ startedAt: new Date() }).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (status === 'READY') return db.update(kitchenTickets).set({ readyAt: new Date(), closedAt: new Date() }).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (status === 'CANCELLED') return db.update(kitchenTickets).set({ closedAt: new Date() }).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    return Promise.resolve()
  }

  static async transition(merchantId: string, id: string, nextStatus: string) {
    const [ticket] = await db.select().from(kitchenTickets).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Kitchen ticket not found')
    if (!isKotStatus(nextStatus)) throw badRequest('INVALID_KOT_STATUS', 'Unknown KOT status')
    assertKotTransition(ticket.status, nextStatus)

    await db.transaction(async (tx) => {
      await tx.update(kitchenTickets).set({ status: nextStatus, closedAt: nextStatus === 'CANCELLED' ? new Date() : ticket.closedAt, readyAt: nextStatus === 'READY' ? new Date() : ticket.readyAt, startedAt: nextStatus === 'PREPARING' ? new Date() : ticket.startedAt }).where(eq(kitchenTickets.id, id))
      if (nextStatus === 'READY') {
        await tx.update(kitchenTicketItems).set({ status: 'READY', readyAt: new Date() }).where(and(eq(kitchenTicketItems.ticketId, id), eq(kitchenTicketItems.status, 'PENDING')))
      }
    })
    return this.get(merchantId, id)
  }

  static async bump(merchantId: string, id: string) {
    return this.transition(merchantId, id, 'READY')
  }

  static async recall(merchantId: string, id: string) {
    return this.transition(merchantId, id, 'RECALLED')
  }

  static async setPriority(merchantId: string, id: string, priority: 'LOW' | 'NORMAL' | 'HIGH') {
    const [ticket] = await db.select().from(kitchenTickets).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Kitchen ticket not found')
    const [updated] = await db.update(kitchenTickets).set({ priority }).where(eq(kitchenTickets.id, id)).returning()
    return ok(updated)
  }

  /** Item-level completion: picking items READY/DONE can bump the whole ticket when all lines are done. */
  static async itemStatus(merchantId: string, id: string, itemId: string, status: string) {
    const [ticket] = await db.select().from(kitchenTickets).where(and(eq(kitchenTickets.id, id), eq(kitchenTickets.merchantId, merchantId)))
    if (!ticket) throw notFound('TICKET_NOT_FOUND', 'Kitchen ticket not found')
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
        await this.transition(merchantId, id, 'READY')
      }
    }
    return this.get(merchantId, id)
  }
}

/* ------------------------------ KDS board ------------------------------ */

export class KdsBoardService {
  /** Group open (and ready) tickets by station — the KDS display model. */
  static async board(merchantId: string, query: { outletId?: string; stationId?: string }) {
    const conds = [eq(kitchenTickets.merchantId, merchantId), notInArray(kitchenTickets.status, ['CANCELLED'])]
    if (query.outletId) conds.push(eq(kitchenTickets.outletId, query.outletId))
    if (query.stationId) conds.push(eq(kitchenTickets.stationId, query.stationId))

    const stations = query.stationId
      ? await db.select().from(kitchenStations).where(and(eq(kitchenStations.merchantId, merchantId), eq(kitchenStations.id, query.stationId)))
      : await db.select().from(kitchenStations).where(and(eq(kitchenStations.merchantId, merchantId), notInArray(kitchenStations.status, ['archived']))).orderBy(asc(kitchenStations.sortOrder))

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
    const items = ticketIds.length
      ? await db.select().from(kitchenTicketItems).where(inArray(kitchenTicketItems.ticketId, ticketIds)).orderBy(asc(kitchenTicketItems.createdAt))
      : []
    const itemsByTicket = new Map<string, (typeof items)[number][]>()
    for (const it of items) {
      if (!itemsByTicket.has(it.ticketId)) itemsByTicket.set(it.ticketId, [])
      itemsByTicket.get(it.ticketId)!.push(it)
    }

    const board = stations.map((s) => ({
      id: s.id,
      name: s.name,
      prepSlaMin: s.prepSlaMin,
      tickets: tickets
        .filter((t) => t.stationId === s.id)
        .map((t) => ({ ...t, ...addMeta(t), items: itemsByTicket.get(t.id) ?? [] }))
    }))

    return ok({ stations: board, delayedCount: tickets.filter((t) => addMeta(t).delayed).length })
  }
}
