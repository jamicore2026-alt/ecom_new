import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../database/client'
import {
  customers,
  fulfillments,
  merchants,
  orders,
  storeSettings
} from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'
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

export class FulfillmentsService {
  static async list(
    merchantId: string,
    query: { status?: string; orderId?: string; page?: string; limit?: string }
  ) {
    const { page, limit, offset } = parsePagination(query)
    const conditions = [eq(fulfillments.merchantId, merchantId)]
    if (query.status) conditions.push(eq(fulfillments.status, query.status))
    if (query.orderId) conditions.push(eq(fulfillments.orderId, query.orderId))

    const rows = await db
      .select()
      .from(fulfillments)
      .where(and(...conditions))
      .orderBy(desc(fulfillments.createdAt))
      .limit(limit)
      .offset(offset)

    const orderIds = [...new Set(rows.map((r) => r.orderId))]
    const orderRows = orderIds.length
      ? await db
          .select({ id: orders.id, orderNumber: orders.orderNumber, customerId: orders.customerId })
          .from(orders)
          .where(inArray(orders.id, orderIds))
      : []
    const orderById = new Map(orderRows.map((o) => [o.id, o]))

    return ok({
      items: rows.map((f) => ({
        ...f,
        orderNumber: orderById.get(f.orderId)?.orderNumber ?? null,
        customerEmail: null
      })),
      meta: makeMeta(page, limit, rows.length)
    })
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(fulfillments)
      .where(and(eq(fulfillments.id, id), eq(fulfillments.merchantId, merchantId)))
    if (!row) throw notFound('FULFILLMENT_NOT_FOUND', 'Fulfillment not found')
    return ok(row)
  }

  static async create(
    merchantId: string,
    input: {
      orderId: string
      carrier?: string
      courierProvider?: string
      metadata?: Record<string, unknown>
    }
  ) {
    // Validate the order belongs to this merchant and is fulfillable.
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw badRequest('ORDER_NOT_FULFILLABLE', 'Cancelled/refunded orders cannot be fulfilled')
    }

    const [row] = await db
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

    await this.updateOrderFulfillmentStatus(order.merchantId, order.id, 'processing')

    return ok(row)
  }

  static async update(
    merchantId: string,
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
      .where(and(eq(fulfillments.id, id), eq(fulfillments.merchantId, merchantId)))
    if (!existing) throw notFound('FULFILLMENT_NOT_FOUND', 'Fulfillment not found')

    let status = existing.status as FulfillmentStatus
    if (input.status && input.status !== existing.status) {
      const allowed = FULFILLMENT_TRANSITIONS[existing.status as FulfillmentStatus] ?? []
      if (!allowed.includes(input.status)) {
        throw badRequest('INVALID_TRANSITION', `Cannot move fulfillment from ${existing.status} to ${input.status}`)
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
    const orderFulfillmentStatus =
      status === 'shipped' || status === 'delivered' || status === 'processing' || status === 'packed'
        ? 'fulfilled'
        : 'unfulfilled'
    await this.updateOrderFulfillmentStatus(merchantId, updated.orderId, orderFulfillmentStatus)

    await dispatchWebhookEvent(merchantId, 'fulfillment.updated', {
      fulfillmentId: updated.id,
      orderId: updated.orderId,
      status: updated.status,
      trackingNumber: updated.trackingNumber
    })

    if (status === 'shipped') {
      await this.sendShippedEmail(merchantId, updated.orderId)
    }

    return ok(updated)
  }

  static async markShipped(
    merchantId: string,
    id: string,
    input: { trackingNumber?: string; trackingUrl?: string; labelUrl?: string; carrier?: string }
  ) {
    return this.update(merchantId, id, { status: 'shipped', ...input })
  }

  static async cancel(merchantId: string, id: string) {
    return this.update(merchantId, id, { status: 'cancelled' })
  }

  private static async updateOrderFulfillmentStatus(
    merchantId: string,
    orderId: string,
    status: string
  ) {
    await db
      .update(orders)
      .set({ fulfillmentStatus: status })
      .where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
  }

  private static async sendShippedEmail(merchantId: string, orderId: string) {
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

      const result = await getMailer().send({
        from: `${storeName} <${fromEmail}>`,
        to: customer.email,
        subject: `Your order ${order.orderNumber} has shipped`,
        html
      })
      if (result.ok) {
        const [orderMerchant] = await db
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.id, orderId))
        void orderMerchant
      }
    } catch (e) {
      console.error('[fulfillments] shipped email failed:', e)
    }
  }

  private static async dispatch(merchantId: string, event: string, payload: Record<string, unknown>) {
    await dispatchWebhookEvent(merchantId, event, payload)
  }
}
