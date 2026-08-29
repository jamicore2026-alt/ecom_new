import { and, asc, count, desc, eq, ilike, inArray } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  orders,
  foodOrderItems,
  menuItems,
  products,
  modifiers,
  menuItemModifiers,
  outlets
} from '../../database/schema'
import { ok } from '../../shared/response'
import { parsePagination, makeMeta } from '../../shared/pagination'
import { badRequest, notFound, conflict } from '../../shared/errors'
import { isFoodOrderType, isValidOrderType, isFoodOrderStatus, assertOrderTransition } from '../../shared/order-state'

const round2 = (n: number) => Math.round(n * 100) / 100

const ORDER_COLUMNS = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  status: orders.status,
  paymentStatus: orders.paymentStatus,
  orderType: orders.orderType,
  outletId: orders.outletId,
  tableSessionId: orders.tableSessionId,
  scheduledFor: orders.scheduledFor,
  subtotal: orders.subtotal,
  taxTotal: orders.taxTotal,
  total: orders.total,
  currency: orders.currency,
  notes: orders.notes,
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt
} as const

type ResolverCtx = {
  menuGroups: Map<string, Set<string>>
  mods: typeof modifiers.$inferSelect[]
}

export class FoodOrdersService {
  static async list(merchantId: string, query: { orderType?: string; status?: string; outletId?: string; search?: string; page?: string | number; limit?: string | number }) {
    const { page, limit, offset } = parsePagination(query)
    const conds = [eq(orders.merchantId, merchantId), inArray(orders.orderType, ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'QR', 'POS', 'SCHEDULED'])]

    if (query.orderType) {
      if (!isValidOrderType(query.orderType)) throw badRequest('INVALID_ORDER_TYPE', 'Unknown order type')
      conds.push(eq(orders.orderType, query.orderType))
    }
    if (query.status) {
      if (!isFoodOrderStatus(query.status)) throw badRequest('INVALID_STATUS', 'Unknown food order status')
      conds.push(eq(orders.status, query.status))
    }
    if (query.outletId) conds.push(eq(orders.outletId, query.outletId))
    if (query.search) conds.push(ilike(orders.orderNumber, `%${query.search.trim()}%`))

    const where = and(...conds)
    const [{ value: total }] = await db.select({ value: count() }).from(orders).where(where)
    const rows = await db
      .select({ ...ORDER_COLUMNS, outletName: outlets.name })
      .from(orders)
      .leftJoin(outlets, eq(orders.outletId, outlets.id))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, total) })
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select({ ...ORDER_COLUMNS, outletName: outlets.name })
      .from(orders)
      .leftJoin(outlets, eq(orders.outletId, outlets.id))
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!row) throw notFound('NOT_FOUND', 'Food order not found')

    const items = await db.select().from(foodOrderItems).where(eq(foodOrderItems.orderId, id)).orderBy(asc(foodOrderItems.createdAt))
    return ok({ ...row, items })
  }

  static async create(merchantId: string, input: {
    orderType: string
    outletId: string
    items: { menuItemId: string; quantity: number; modifiers?: { modifierId: string; quantity?: number }[] }[]
    notes?: string
    scheduledFor?: string
  }) {
    if (!isFoodOrderType(input.orderType)) throw badRequest('INVALID_ORDER_TYPE', `${input.orderType} is not a food order type`)

    const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, input.outletId), eq(outlets.merchantId, merchantId)))
    if (!outlet) throw notFound('OUTLET_NOT_FOUND', 'Outlet not found')

    const menuIds = [...new Set(input.items.map((i) => i.menuItemId))]
    const loaded = await db
      .select({
        id: menuItems.id,
        available: menuItems.available,
        status: menuItems.status,
        taxRate: menuItems.taxRate,
        productId: menuItems.productId,
        productName: products.name,
        productPrice: products.price
      })
      .from(menuItems)
      .innerJoin(products, eq(menuItems.productId, products.id))
      .where(and(eq(menuItems.merchantId, merchantId), inArray(menuItems.id, menuIds)))
    const byId = new Map(loaded.map((m) => [m.id, m]))

    const ctx = await this.buildResolver(merchantId, menuIds)
    const orderNumber = `#F${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`

    const { order } = await db.transaction(async (tx) => {
      const [order] = await tx.insert(orders).values({
        merchantId,
        outletId: input.outletId,
        orderNumber,
        orderType: input.orderType,
        status: 'CREATED',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'unfulfilled',
        subtotal: 0,
        taxTotal: 0,
        total: 0,
        currency: 'USD',
        notes: input.notes ?? null,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null
      }).returning()

      const { subtotal, taxTotal, lines } = this.computeLines(merchantId, order.id, byId, ctx, input.items)
      await tx.insert(foodOrderItems).values(lines)
      const total = round2(subtotal + taxTotal)
      const [updated] = await tx.update(orders).set({ subtotal, taxTotal, total }).where(eq(orders.id, order.id)).returning()
      return { order: updated, lines }
    })

    return this.get(merchantId, order.id)
  }

  static async transition(merchantId: string, id: string, nextStatus: string) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Food order not found')
    if (!isFoodOrderType(order.orderType)) throw badRequest('NOT_FOOD_ORDER', 'This is not a food order')

    assertOrderTransition(order.status, nextStatus, order.orderType)

    const [updated] = await db.update(orders)
      .set({ status: nextStatus })
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
      .returning()
    return ok(updated)
  }

  static async cancel(merchantId: string, id: string) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Food order not found')
    if (!isFoodOrderType(order.orderType)) throw badRequest('NOT_FOOD_ORDER', 'This is not a food order')
    if (order.status === 'COMPLETED') throw conflict('INVALID_TRANSITION', 'A completed order cannot be cancelled')
    return this.transition(merchantId, id, 'CANCELLED')
  }

  static async update(merchantId: string, id: string, input: { items?: { menuItemId: string; quantity: number; modifiers?: { modifierId: string; quantity?: number }[] }[]; notes?: string; scheduledFor?: string }) {
    const [order] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Food order not found')
    if (!isFoodOrderType(order.orderType)) throw badRequest('NOT_FOOD_ORDER', 'This is not a food order')
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw conflict('ORDER_LOCKED', `Cannot edit a ${order.status.toLowerCase()} order`)
    }

    if (input.notes !== undefined || input.scheduledFor !== undefined) {
      await db.update(orders).set({
        notes: input.notes !== undefined ? input.notes : order.notes,
        scheduledFor: input.scheduledFor !== undefined ? (input.scheduledFor ? new Date(input.scheduledFor) : null) : order.scheduledFor
      }).where(eq(orders.id, id))
    }

    if (input.items) {
      const menuIds = [...new Set(input.items.map((i) => i.menuItemId))]
      const loaded = await db
        .select({ id: menuItems.id, available: menuItems.available, status: menuItems.status, taxRate: menuItems.taxRate, productId: menuItems.productId, productName: products.name, productPrice: products.price })
        .from(menuItems)
        .innerJoin(products, eq(menuItems.productId, products.id))
        .where(and(eq(menuItems.merchantId, merchantId), inArray(menuItems.id, menuIds)))
      const byId = new Map(loaded.map((m) => [m.id, m]))
      const ctx = await this.buildResolver(merchantId, menuIds)
      const { subtotal, taxTotal, lines } = this.computeLines(merchantId, id, byId, ctx, input.items)

      await db.transaction(async (tx) => {
        await tx.delete(foodOrderItems).where(eq(foodOrderItems.orderId, id))
        await tx.insert(foodOrderItems).values(lines)
        await tx.update(orders).set({ subtotal, taxTotal, total: round2(subtotal + taxTotal) }).where(eq(orders.id, id))
      })
    }

    return this.get(merchantId, id)
  }

  private static async buildResolver(merchantId: string, menuIds: string[]): Promise<ResolverCtx> {
    const links = await db
      .select({ menuItemId: menuItemModifiers.menuItemId, modifierGroupId: menuItemModifiers.modifierGroupId })
      .from(menuItemModifiers)
      .where(inArray(menuItemModifiers.menuItemId, menuIds))
    const menuGroups = new Map<string, Set<string>>()
    for (const l of links) {
      if (!menuGroups.has(l.menuItemId)) menuGroups.set(l.menuItemId, new Set())
      menuGroups.get(l.menuItemId)!.add(l.modifierGroupId)
    }
    const groupIds = [...new Set(links.map((l) => l.modifierGroupId))]
    const mods = groupIds.length
      ? await db.select().from(modifiers).where(and(eq(modifiers.merchantId, merchantId), inArray(modifiers.modifierGroupId, groupIds)))
      : []
    return { menuGroups, mods }
  }

  private static computeLines(
    merchantId: string,
    orderId: string,
    byId: Map<string, { id: string; available: boolean; status: string; taxRate: number; productId: string; productName: string; productPrice: number }>,
    ctx: ResolverCtx,
    items: { menuItemId: string; quantity: number; modifiers?: { modifierId: string; quantity?: number }[] }[]
  ) {
    let subtotal = 0
    let taxTotal = 0
    const lines: (typeof foodOrderItems.$inferInsert)[] = []

    for (const req of items) {
      const menu = byId.get(req.menuItemId)
      if (!menu) throw notFound('MENU_ITEM_NOT_FOUND', `Menu item not found: ${req.menuItemId}`)
      if (menu.status !== 'active' || !menu.available) throw conflict('ITEM_UNAVAILABLE', `${menu.productName} is not currently available`)

      const groupIds = ctx.menuGroups.get(menu.id) ?? new Set()
      let modifierTotal = 0
      const modifierSnapshot: (typeof foodOrderItems.$inferInsert)['modifiers'] = []
      for (const r of req.modifiers ?? []) {
        const mod = ctx.mods.find((m) => m.id === r.modifierId)
        if (!mod) throw notFound('MODIFIER_NOT_FOUND', `Modifier not found: ${r.modifierId}`)
        if (!groupIds.has(mod.modifierGroupId)) throw conflict('MODIFIER_NOT_ON_ITEM', `Modifier ${mod.name} is not offered on this item`)
        if (mod.status !== 'active' || !mod.available) throw conflict('MODIFIER_UNAVAILABLE', `Modifier ${mod.name} is unavailable`)
        const qty = r.quantity ?? 1
        modifierTotal += Number(mod.priceAdjustment) * qty
        modifierSnapshot.push({ modifierId: mod.id, groupName: '', name: mod.name, priceAdjustment: Number(mod.priceAdjustment), quantity: qty })
      }

      const unit = Number(menu.productPrice) + round2(modifierTotal)
      const lineTotal = round2(unit * req.quantity)
      const lineTax = round2(lineTotal * (Number(menu.taxRate) / 100))
      subtotal += lineTotal
      taxTotal += lineTax
      lines.push({
        merchantId,
        orderId,
        menuItemId: menu.id,
        productId: menu.productId,
        name: menu.productName,
        modifiers: modifierSnapshot,
        unitPrice: unit,
        quantity: req.quantity,
        total: lineTotal
      })
    }

    if (lines.length === 0) throw badRequest('NO_ITEMS', 'An order needs at least one item')
    return { subtotal, taxTotal, lines }
  }
}
