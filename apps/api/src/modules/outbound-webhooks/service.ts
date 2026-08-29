import { Type } from '@sinclair/typebox'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { backgroundJobs, webhookDeliveries, webhookEndpoints } from '../../database/schema'
import { badRequest, notFound } from '../../shared/errors'

const WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'order.cancelled',
  'order.shipped',
  'order.delivered',
  'refund.created',
  'refund.completed',
  'return.created',
  'return.approved',
  'product.created',
  'product.updated',
  'inventory.updated',
  'customer.created',
  'fulfillment.created',
  'fulfillment.updated'
] as const

export class OutboundWebhooksService {
  static endpointBodySchema = Type.Object({
    name: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 }),
    secret: Type.String({ minLength: 1 }),
    enabled: Type.Optional(Type.Boolean()),
    events: Type.Array(Type.Union(WEBHOOK_EVENTS.map((e) => Type.Literal(e)) as any))
  })

  static listEndpoints = async (merchantId: string) => {
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.merchantId, merchantId))
      .orderBy(desc(webhookEndpoints.createdAt))
    return rows
  }

  static getEndpoint = async (merchantId: string, id: string) => {
    const [row] = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
    if (!row) throw notFound('ENDPOINT_NOT_FOUND', 'Webhook endpoint not found')
    return row
  }

  static createEndpoint = async (
    merchantId: string,
    input: {
      name: string
      url: string
      secret: string
      enabled?: boolean
      events: (typeof WEBHOOK_EVENTS)[number][]
    }
  ) => {
    const [row] = await db
      .insert(webhookEndpoints)
      .values({
        merchantId,
        name: input.name,
        url: input.url,
        secret: input.secret,
        enabled: input.enabled ?? true,
        events: input.events,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning()
    return row
  }

  static updateEndpoint = async (
    merchantId: string,
    id: string,
    input: {
      name?: string
      url?: string
      secret?: string
      enabled?: boolean
      events?: (typeof WEBHOOK_EVENTS)[number][]
    }
  ) => {
    await this.getEndpoint(merchantId, id)
    const [row] = await db
      .update(webhookEndpoints)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.url !== undefined && { url: input.url }),
        ...(input.secret !== undefined && { secret: input.secret }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.events !== undefined && { events: input.events }),
        updatedAt: new Date()
      })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
      .returning()
    return row
  }

  static deleteEndpoint = async (merchantId: string, id: string) => {
    await this.getEndpoint(merchantId, id)
    const [row] = await db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
      .returning()
    return row
  }

  static listDeliveries = async (merchantId: string, query?: { status?: string }) => {
    const conditions = [eq(webhookDeliveries.merchantId, merchantId)]
    if (query?.status) conditions.push(eq(webhookDeliveries.status, query.status))
    return db
      .select()
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(100)
  }

  static getDelivery = async (merchantId: string, id: string) => {
    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.merchantId, merchantId)))
    if (!row) throw notFound('DELIVERY_NOT_FOUND', 'Webhook delivery not found')
    return row
  }

  static retryDelivery = async (merchantId: string, id: string) => {
    const delivery = await this.getDelivery(merchantId, id)
    const endpoint = await this.getEndpoint(merchantId, delivery.endpointId)
    if (!endpoint.enabled) throw badRequest('ENDPOINT_DISABLED', 'Webhook endpoint is disabled')

    const [updated] = await db
      .update(webhookDeliveries)
      .set({ status: 'pending', attempts: 0, nextRetryAt: new Date(), lastError: null })
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.merchantId, merchantId)))
      .returning()
    return updated
  }

  static listJobs = async (merchantId: string) => {
    return db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.merchantId, merchantId))
      .orderBy(desc(backgroundJobs.createdAt))
  }

  static getJob = async (merchantId: string, id: string) => {
    const [row] = await db
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.merchantId, merchantId)))
    if (!row) throw notFound('JOB_NOT_FOUND', 'Background job not found')
    return row
  }
}
