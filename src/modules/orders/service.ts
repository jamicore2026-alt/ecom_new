import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  customers,
  inventoryLogs,
  orderItems,
  orders,
  productVariants,
  refunds,
  returnsTable
} from '../../database/schema'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import type { Order } from '../../database/schema'
import type { OrderStatus } from '../../shared/types'

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: []
}

interface OrderQuery {
  page?: string
  limit?: string
  status?: string
  paymentStatus?: string
  customerId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

export class OrdersService {
  /* --------------------------------- list --------------------------------- */

  static async list(merchantId: string, q: OrderQuery) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(orders.merchantId, merchantId)]

    if (q.status) conditions.push(eq(orders.status, q.status))
    if (q.paymentStatus) conditions.push(eq(orders.paymentStatus, q.paymentStatus))
    if (q.customerId) conditions.push(eq(orders.customerId, q.customerId))
    if (q.dateFrom) conditions.push(gte(orders.createdAt, new Date(q.dateFrom)))
    if (q.dateTo) conditions.push(lte(orders.createdAt, new Date(q.dateTo)))
    if (q.search) {
      const s = `%${q.search.trim()}%`
      const cond = or(
        ilike(orders.orderNumber, s),
        ilike(sql`coalesce(${customers.firstName},'')`, s),
        ilike(sql`coalesce(${customers.lastName},'')`, s),
        ilike(sql`coalesce(${customers.email},'')`, s)
      )
      if (cond) conditions.push(cond)
    }

    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)

    const rows = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        fulfillmentStatus: orders.fulfillmentStatus,
        total: orders.total,
        subtotal: orders.subtotal,
        discountTotal: orders.discountTotal,
        shippingTotal: orders.shippingTotal,
        taxTotal: orders.taxTotal,
        currency: orders.currency,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customerId: orders.customerId,
        customerName: sql<string>`concat_ws(' ', ${customers.firstName}, ${customers.lastName})`,
        customerEmail: customers.email,
        itemCount: sql<number>`(
          select coalesce(sum(${orderItems.quantity}), 0) from ${orderItems}
          where ${orderItems.orderId} = ${orders.id}
        )`
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  /* -------------------------------- detail -------------------------------- */

  static async get(merchantId: string, id: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')

    const items = await db
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        variantId: orderItems.variantId,
        name: orderItems.name,
        sku: orderItems.sku,
        price: orderItems.price,
        quantity: orderItems.quantity,
        total: orderItems.total,
        optionValues: productVariants.optionValues
      })
      .from(orderItems)
      .leftJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .where(eq(orderItems.orderId, id))

    const [customer] = order.customerId
      ? await db.select().from(customers).where(eq(customers.id, order.customerId))
      : []

    const returns = await db
      .select()
      .from(returnsTable)
      .where(eq(returnsTable.orderId, id))

    const refundList = await db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, id))

    return ok({ ...order, customer: customer ?? null, items, returns, refunds: refundList })
  }

  /* ------------------------------- workflow ------------------------------- */

  static async updateStatus(
    merchantId: string,
    id: string,
    input: { status?: string; paymentStatus?: string; fulfillmentStatus?: string }
  ) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')

    if (input.status && input.status !== order.status) {
      const allowed = TRANSITIONS[order.status as OrderStatus]
      if (!allowed.includes(input.status as OrderStatus)) {
        throw badRequest(
          'INVALID_TRANSITION',
          `Cannot move order from ${order.status} to ${input.status}`
        )
      }
    }

    const values: Partial<Order> = {}
    if (input.status) values.status = input.status as OrderStatus
    if (input.paymentStatus) values.paymentStatus = input.paymentStatus
    if (input.fulfillmentStatus) values.fulfillmentStatus = input.fulfillmentStatus

    if (Object.keys(values).length === 0) return ok(order)

    const [updated] = await db
      .update(orders)
      .set(values)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
      .returning()

    return ok(updated)
  }

  static async cancel(merchantId: string, id: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw badRequest('INVALID_TRANSITION', `Order is already ${order.status}`)
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id))

    const result = await db.transaction(async (tx) => {
      await this.restockTx(
        tx,
        merchantId,
        items
          .filter((i) => i.variantId)
          .map((i) => ({ variantId: i.variantId as string, quantity: i.quantity })),
        'cancel'
      )

      const [updated] = await tx
        .update(orders)
        .set({
          status: 'cancelled',
          paymentStatus:
            order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded'
              ? 'refunded'
              : 'failed',
          fulfillmentStatus: 'unfulfilled'
        })
        .where(eq(orders.id, id))
        .returning()
      return updated
    })

    return ok(result)
  }

  /* ------------------------- returns / refunds ---------------------------- */

  static async createReturn(
    merchantId: string,
    input: { orderId: string; orderItemId: string; quantity: number; reason?: string }
  ) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')
    if (order.status === 'cancelled') {
      throw badRequest('BAD_REQUEST', 'Cannot return a cancelled order')
    }

    const [item] = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orderId, order.id)))
    if (!item) throw notFound('NOT_FOUND', 'Order item not found')

    // Cumulative check — sum of all non-rejected returns must not exceed purchased qty
    const [returnedRow] = await db
      .select({ returned: sql<number>`coalesce(sum(${returnsTable.quantity}), 0)` })
      .from(returnsTable)
      .where(
        and(
          eq(returnsTable.orderItemId, item.id),
          sql`${returnsTable.status} != 'rejected'`
        )
      )
    const alreadyReturned = Number(returnedRow?.returned ?? 0)
    const available = item.quantity - alreadyReturned
    if (input.quantity > available) {
      throw badRequest('BAD_REQUEST', `Only ${available} unit(s) available to return`)
    }

    const [created] = await db
      .insert(returnsTable)
      .values({
        merchantId,
        orderId: order.id,
        orderItemId: item.id,
        quantity: input.quantity,
        amount: Number((item.price * input.quantity).toFixed(2)),
        reason: input.reason ?? null,
        status: 'pending'
      })
      .returning()

    return ok(created)
  }

  static async updateReturn(
    merchantId: string,
    id: string,
    input: { status: 'approved' | 'rejected' }
  ) {
    const [ret] = await db
      .select()
      .from(returnsTable)
      .where(and(eq(returnsTable.id, id), eq(returnsTable.merchantId, merchantId)))
    if (!ret) throw notFound('NOT_FOUND', 'Return not found')
    if (ret.status !== 'pending') {
      throw badRequest('BAD_REQUEST', `Return is already ${ret.status}`)
    }

    const updated = await db.transaction(async (tx) => {
      if (input.status === 'approved' && ret.orderItemId) {
        const [item] = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.id, ret.orderItemId))
        if (item?.variantId) {
          await this.restockTx(
            tx,
            merchantId,
            [{ variantId: item.variantId, quantity: ret.quantity }],
            'return'
          )
        }
      }

      const [row] = await tx
        .update(returnsTable)
        .set({ status: input.status })
        .where(eq(returnsTable.id, id))
        .returning()
      return row
    })

    return ok(updated)
  }

  static async listReturns(merchantId: string, orderId?: string) {
    const conditions = [eq(returnsTable.merchantId, merchantId)]
    if (orderId) conditions.push(eq(returnsTable.orderId, orderId))
    const rows = await db
      .select({
        id: returnsTable.id,
        orderId: returnsTable.orderId,
        orderItemId: returnsTable.orderItemId,
        quantity: returnsTable.quantity,
        amount: returnsTable.amount,
        reason: returnsTable.reason,
        status: returnsTable.status,
        createdAt: returnsTable.createdAt,
        orderNumber: orders.orderNumber
      })
      .from(returnsTable)
      .innerJoin(orders, eq(returnsTable.orderId, orders.id))
      .where(and(...conditions))
      .orderBy(desc(returnsTable.createdAt))
    return ok(rows)
  }

  static async createRefund(
    merchantId: string,
    input: { orderId: string; returnId?: string; amount: number; method?: string }
  ) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')

    // Only paid orders can be refunded
    if (!['paid', 'partially_refunded'].includes(order.paymentStatus)) {
      throw badRequest('BAD_REQUEST', 'Only paid orders can be refunded')
    }

    // If a return is attached it must belong to this order
    if (input.returnId) {
      const [ret] = await db
        .select()
        .from(returnsTable)
        .where(eq(returnsTable.id, input.returnId))
      if (!ret || ret.orderId !== order.id) {
        throw badRequest('BAD_REQUEST', 'Return does not belong to this order')
      }
    }

    const existing = await db
      .select({ sum: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
      .from(refunds)
      .where(eq(refunds.orderId, order.id))

    const already = Number(existing[0]?.sum ?? 0)
    if (already + input.amount > order.total + 0.001) {
      throw badRequest(
        'BAD_REQUEST',
        `Refund exceeds order balance (${(order.total - already).toFixed(2)} remaining)`
      )
    }

    const refund = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(refunds)
        .values({
          merchantId,
          orderId: order.id,
          returnId: input.returnId ?? null,
          amount: input.amount,
          method: input.method ?? 'original',
          status: 'completed'
        })
        .returning()

      const totalRefunded = already + input.amount
      const fullyRefunded = totalRefunded >= order.total - 0.001
      await tx
        .update(orders)
        .set({
          paymentStatus: fullyRefunded ? 'refunded' : 'partially_refunded',
          ...(fullyRefunded && order.status === 'delivered' ? { status: 'refunded' } : {})
        })
        .where(eq(orders.id, order.id))
      return row
    })

    return ok(refund)
  }

  static async listRefunds(merchantId: string, orderId?: string) {
    const conditions = [eq(refunds.merchantId, merchantId)]
    if (orderId) conditions.push(eq(refunds.orderId, orderId))
    const rows = await db
      .select({
        id: refunds.id,
        orderId: refunds.orderId,
        returnId: refunds.returnId,
        amount: refunds.amount,
        method: refunds.method,
        status: refunds.status,
        createdAt: refunds.createdAt,
        orderNumber: orders.orderNumber
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .where(and(...conditions))
      .orderBy(desc(refunds.createdAt))
    return ok(rows)
  }

  /* -------------------------------- helpers ------------------------------- */

  private static async restockTx(
    tx: any,
    merchantId: string,
    items: Array<{ variantId: string; quantity: number }>,
    reason: string
  ) {
    for (const { variantId, quantity } of items) {
      const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId))
      if (!v) continue
      const afterValue = v.inventory + quantity
      await tx
        .update(productVariants)
        .set({ inventory: afterValue })
        .where(eq(productVariants.id, variantId))
      await tx.insert(inventoryLogs).values({
        merchantId,
        variantId,
        change: quantity,
        beforeValue: v.inventory,
        afterValue,
        reason,
        reference: 'order'
      })
    }
  }
}