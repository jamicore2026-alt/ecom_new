import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { createLogger } from '../../shared/logger'

const log = createLogger('fulfillments')
import {
  customers,
  fulfillmentItems,
  fulfillments,
  merchants,
  orderItems,
  orders,
  storeSettings
} from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { assertOrderInBranchScope, branchOrderCondition } from '../../shared/outlet-scope'
import { dispatchWebhookEvent } from '../../shared/webhook-delivery'
import { getMailer, renderEmail } from '../../shared/mailer'

export const FULFILLMENT_STATUSES = [
  'unfulfilled',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'failed',
  'returned',
  'cancelled'
] as const
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  unfulfilled: ['processing'],
  processing: ['packed', 'cancelled', 'failed'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'failed', 'returned'],
  delivered: [],
  failed: ['processing'],
  returned: [],
  cancelled: []
}

/**
 * The order-level `fulfillmentStatus` column is binary (unfulfilled|fulfilled,
 * see orders `fulfillmentStatusSchema`). The per-fulfillment granular status
 * lives on the fulfillment row; only shipped/delivered warrant 'fulfilled' at
 * the order level.
 */
const toOrderFulfillmentStatus = (s: FulfillmentStatus): 'unfulfilled' | 'fulfilled' =>
  s === 'shipped' || s === 'delivered' ? 'fulfilled' : 'unfulfilled'

export class FulfillmentsService {
  static async list(
    db: DB,
    merchantId: string,
    branchIds: string[] | null,
    query: { status?: string; orderId?: string; page?: string; limit?: string }
  ) {
    const { page, limit, offset } = parsePagination(query)
    const conditions = [eq(fulfillments.merchantId, merchantId)]
    if (query.status) conditions.push(eq(fulfillments.status, query.status))
    if (query.orderId) conditions.push(eq(fulfillments.orderId, query.orderId))
    const scopeCondition = branchOrderCondition(branchIds)
    if (scopeCondition) conditions.push(scopeCondition)

    const rows = await db
      .select()
      .from(fulfillments)
      .innerJoin(orders, eq(fulfillments.orderId, orders.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(and(...conditions))
      .orderBy(desc(fulfillments.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({
      items: rows.map((r) => ({
        ...r.fulfillments,
        orderNumber: r.orders.orderNumber,
        customerEmail: r.customers?.email ?? null
      })),
      meta: makeMeta(page, limit, rows.length)
    })
  }

  static async get(db: DB, merchantId: string, branchIds: string[] | null, id: string) {
    const [row] = await db
      .select()
      .from(fulfillments)
      .innerJoin(orders, eq(fulfillments.orderId, orders.id))
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(and(eq(fulfillments.id, id), eq(fulfillments.merchantId, merchantId)))
    if (!row) throw notFound('FULFILLMENT_NOT_FOUND', 'Fulfillment not found')
    assertOrderInBranchScope(branchIds, row.orders.outletId)
    const lines = await db
      .select()
      .from(fulfillmentItems)
      .where(eq(fulfillmentItems.fulfillmentId, row.fulfillments.id))
    return ok({
      ...row.fulfillments,
      orderNumber: row.orders.orderNumber,
      customerEmail: row.customers?.email ?? null,
      lines
    })
  }

  static async create(
    db: DB,
    merchantId: string,
    branchIds: string[] | null,
    input: {
      orderId: string
      carrier?: string
      courierProvider?: string
      metadata?: Record<string, unknown>
      items?: Array<{ orderItemId: string; quantity: number }>
    }
  ) {
    // Validate the order belongs to this merchant and is fulfillable.
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')
    assertOrderInBranchScope(branchIds, order.outletId)
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw badRequest('ORDER_NOT_FULFILLABLE', 'Cancelled/refunded orders cannot be fulfilled')
    }

    // Empty/missing `items` = whole-order legacy fulfillment (no lines stored).
    const requested = (input.items ?? []).filter((l) => l.quantity >= 1)
    if ((input.items ?? []).length > 0 && requested.length !== (input.items ?? []).length) {
      throw badRequest('INVALID_QUANTITY', 'Line quantities must be >= 1')
    }
    // Merge duplicate lines for the same order item so the cumulative check
    // sees the true requested total.
    const merged = new Map<string, number>()
    for (const line of requested) {
      merged.set(line.orderItemId, (merged.get(line.orderItemId) ?? 0) + line.quantity)
    }

    const created = await db.transaction(async (tx) => {
      if (merged.size > 0) {
        const rows = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
        const byId = new Map(rows.map((r) => [r.id, r]))
        for (const [orderItemId, quantity] of merged) {
          const item = byId.get(orderItemId)
          if (!item) {
            throw badRequest('ORDER_ITEM_MISMATCH', 'Order item does not belong to this order')
          }
          // Cumulative quantity across non-cancelled fulfillments for this
          // order item must never exceed the ordered quantity.
          const [sumRow] = await tx
            .select({ total: sql<number>`coalesce(sum(${fulfillmentItems.quantity}), 0)` })
            .from(fulfillmentItems)
            .innerJoin(fulfillments, eq(fulfillmentItems.fulfillmentId, fulfillments.id))
            .where(
              and(
                eq(fulfillmentItems.orderItemId, orderItemId),
                eq(fulfillments.orderId, order.id),
                ne(fulfillments.status, 'cancelled')
              )
            )
          const already = Number(sumRow?.total ?? 0)
          if (already + quantity > item.quantity) {
            throw badRequest(
              'OVER_FULFILLED',
              `Only ${item.quantity - already} unit(s) of "${item.name}" left to fulfill`
            )
          }
        }
      }

      const [row] = await tx
        .insert(fulfillments)
        .values({
          merchantId,
          orderId: order.id,
          status: 'unfulfilled',
          carrier: input.carrier ?? null,
          courierProvider: input.courierProvider ?? null,
          metadata: input.metadata ?? {}
        })
        .returning()

      let lines: (typeof fulfillmentItems.$inferSelect)[] = []
      if (merged.size > 0) {
        lines = await tx
          .insert(fulfillmentItems)
          .values(
            [...merged].map(([orderItemId, quantity]) => ({
              merchantId,
              fulfillmentId: row.id,
              orderItemId,
              quantity
            }))
          )
          .returning()
      }

      return { row, lines }
    })

    // The order-level fulfillmentStatus is binary — a freshly created fulfillment
    // row stays 'unfulfilled' until it ships (see toOrderFulfillmentStatus).
    await dispatchWebhookEvent(db, merchantId, 'fulfillment.created', {
      fulfillmentId: created.row.id,
      orderId: created.row.orderId,
      status: created.row.status
    })

    return ok({ ...created.row, lines: created.lines })
  }

  static async update(
    db: DB,
    merchantId: string,
    branchIds: string[] | null,
    id: string,
    input: {
      status?: FulfillmentStatus
      carrier?: string
      courierProvider?: string
      trackingNumber?: string
      trackingUrl?: string
      labelUrl?: string
      metadata?: Record<string, unknown>
    }
  ) {
    const [existing] = await db
      .select()
      .from(fulfillments)
      .innerJoin(orders, eq(fulfillments.orderId, orders.id))
      .where(and(eq(fulfillments.id, id), eq(fulfillments.merchantId, merchantId)))
    if (!existing) throw notFound('FULFILLMENT_NOT_FOUND', 'Fulfillment not found')
    assertOrderInBranchScope(branchIds, existing.orders.outletId)

    let status = existing.fulfillments.status as FulfillmentStatus
    if (input.status && input.status !== existing.fulfillments.status) {
      const allowed = FULFILLMENT_TRANSITIONS[existing.fulfillments.status as FulfillmentStatus] ?? []
      if (!allowed.includes(input.status)) {
        throw badRequest('INVALID_TRANSITION', `Cannot move fulfillment from ${existing.fulfillments.status} to ${input.status}`)
      }
      status = input.status
    }

    const [updated] = await db
      .update(fulfillments)
      .set({
        ...(input.status && { status: input.status }),
        ...(input.carrier !== undefined && { carrier: input.carrier }),
        ...(input.courierProvider !== undefined && { courierProvider: input.courierProvider }),
        ...(input.trackingNumber !== undefined && { trackingNumber: input.trackingNumber }),
        ...(input.trackingUrl !== undefined && { trackingUrl: input.trackingUrl }),
        ...(input.labelUrl !== undefined && { labelUrl: input.labelUrl }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
        ...(status === 'shipped' && { shippedAt: new Date() }),
        ...(status === 'delivered' && { deliveredAt: new Date() }),
        updatedAt: new Date()
      })
      .where(and(eq(fulfillments.id, id), eq(fulfillments.merchantId, merchantId)))
      .returning()

    // Derive the order-level fulfillment status from this fulfillment's status.
    // Only shipped/delivered move the order to 'fulfilled' (binary column).
    await this.updateOrderFulfillmentStatus(
      db,
      merchantId,
      updated.orderId,
      toOrderFulfillmentStatus(status)
    )

    await dispatchWebhookEvent(db, merchantId, 'fulfillment.updated', {
      fulfillmentId: updated.id,
      orderId: updated.orderId,
      status: updated.status,
      trackingNumber: updated.trackingNumber
    })

    if (status === 'shipped') {
      await this.sendShippedEmail(db, merchantId, updated.orderId)
    }

    return ok(updated)
  }

  static async markShipped(
    db: DB,
    merchantId: string,
    branchIds: string[] | null,
    id: string,
    input: { trackingNumber?: string; trackingUrl?: string; labelUrl?: string; carrier?: string }
  ) {
    return this.update(db, merchantId, branchIds, id, { status: 'shipped', ...input })
  }

  static async cancel(db: DB, merchantId: string, branchIds: string[] | null, id: string) {
    return this.update(db, merchantId, branchIds, id, { status: 'cancelled' })
  }

  private static async updateOrderFulfillmentStatus(
    db: DB,
    merchantId: string,
    orderId: string,
    status: string
  ) {
    await db
      .update(orders)
      .set({ fulfillmentStatus: status })
      .where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
  }

  private static async sendShippedEmail(db: DB, merchantId: string, orderId: string) {
    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
      if (!order?.customerId) return
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, order.customerId))
      if (!customer) return
      const [merchant] = await db
        .select({ name: merchants.name })
        .from(merchants)
        .where(eq(merchants.id, merchantId))
      const [settings] = await db
        .select({ name: storeSettings.name })
        .from(storeSettings)
        .where(eq(storeSettings.merchantId, merchantId))

      const storeName = settings?.name ?? merchant?.name ?? 'Our store'
      const fromEmail = process.env.MAIL_FROM_FALLBACK ?? 'onboarding@resend.dev'
      const html = renderEmail({
        title: `Your order ${order.orderNumber} has shipped`,
        intro: 'Great news — your order is on its way!',
        storeName,
        lines: [{ label: 'Order', value: order.orderNumber }]
      })

      await getMailer().send({
        from: `${storeName} <${fromEmail}>`,
        to: customer.email,
        subject: `Your order ${order.orderNumber} has shipped`,
        html
      })
    } catch (e) {
      log.error('shipped email failed', e)
    }
  }
}
