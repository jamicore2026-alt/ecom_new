import { Type } from '@sinclair/typebox'
import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { backgroundJobs, webhookDeliveries, webhookEndpoints } from '../../database/schema'
import { badRequest, notFound } from '../../shared/errors'
import { encryptJson, decryptJson, maskSecret } from '../../shared/crypto'

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

  static rotateSecretBodySchema = Type.Object({
    secret: Type.Optional(Type.String({ minLength: 1 }))
  })

  /**
   * HTTPS-only enforcement for endpoint URLs. `http://` is accepted solely
   * for loopback hosts (localhost / 127.0.0.1 / ::1, e.g. local dev tunnels);
   * anything else non-https (or unparseable) throws a 400 badRequest.
   */
  static assertHttpsExceptLocalhost = (raw: string): void => {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw badRequest('INVALID_URL', 'Invalid webhook endpoint URL')
    }
    if (url.protocol === 'https:') return
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    if (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
      return
    }
    throw badRequest('INSECURE_URL', 'Webhook endpoint URL must use https (http is only allowed for localhost)')
  }

  private static maskEndpoint = (row: typeof webhookEndpoints.$inferSelect) => ({
    ...row,
    secret: maskSecret(row.secret)
  })

  static listEndpoints = async (db: DB, merchantId: string) => {
    const rows = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.merchantId, merchantId))
      .orderBy(desc(webhookEndpoints.createdAt))
    return rows.map(this.maskEndpoint)
  }

  static getEndpoint = async (db: DB, merchantId: string, id: string) => {
    const [row] = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
    if (!row) throw notFound('ENDPOINT_NOT_FOUND', 'Webhook endpoint not found')
    return this.maskEndpoint(row)
  }

  /** Returns the raw (decrypted) endpoint for internal use only (webhook delivery). */
  static getEndpointRaw = async (db: DB, merchantId: string, id: string) => {
    const [row] = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
    if (!row) throw notFound('ENDPOINT_NOT_FOUND', 'Webhook endpoint not found')
    return { ...row, secret: decryptJson<{ secret: string }>(row.secret).secret }
  }

  static createEndpoint = async (
    db: DB,
    merchantId: string,
    input: {
      name: string
      url: string
      secret: string
      enabled?: boolean
      events: (typeof WEBHOOK_EVENTS)[number][]
    }
  ) => {
    this.assertHttpsExceptLocalhost(input.url)
    const encryptedSecret = encryptJson({ secret: input.secret })
    const [row] = await db
      .insert(webhookEndpoints)
      .values({
        merchantId,
        name: input.name,
        url: input.url,
        secret: encryptedSecret,
        enabled: input.enabled ?? true,
        events: input.events,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning()
    return this.maskEndpoint(row)
  }

  static updateEndpoint = async (
    db: DB,
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
    await this.getEndpoint(db, merchantId, id)
    if (input.url !== undefined) this.assertHttpsExceptLocalhost(input.url)
    const [row] = await db
      .update(webhookEndpoints)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.url !== undefined && { url: input.url }),
        ...(typeof input.secret === 'string' && { secret: encryptJson({ secret: input.secret }) }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        // A manual save that (re-)enables the endpoint clears a circuit-breaker trip.
        ...(input.enabled === true && { status: 'active' }),
        ...(input.events !== undefined && { events: input.events }),
        updatedAt: new Date()
      })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
      .returning()
    return this.maskEndpoint(row)
  }

  static deleteEndpoint = async (db: DB, merchantId: string, id: string) => {
    await this.getEndpoint(db, merchantId, id)
    const [row] = await db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
      .returning()
    return row
  }

  static listDeliveries = async (db: DB, merchantId: string, query?: { status?: string }) => {
    const conditions = [eq(webhookDeliveries.merchantId, merchantId)]
    if (query?.status) conditions.push(eq(webhookDeliveries.status, query.status))
    return db
      .select()
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(100)
  }

  static getDelivery = async (db: DB, merchantId: string, id: string) => {
    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.merchantId, merchantId)))
    if (!row) throw notFound('DELIVERY_NOT_FOUND', 'Webhook delivery not found')
    return row
  }

  /**
   * Dual-secret rotation: the current secret moves to `secret_prev` (kept so
   * in-flight/queued consumers can still verify), the new secret becomes
   * current, and `secret_version` is bumped. Verification accepts both;
   * new deliveries are signed with the current secret only.
   * Returns the masked endpoint plus the new plaintext secret (show once).
   */
  static rotateSecret = async (
    db: DB,
    merchantId: string,
    id: string,
    input?: { secret?: string }
  ) => {
    const [row] = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
    if (!row) throw notFound('ENDPOINT_NOT_FOUND', 'Webhook endpoint not found')
    const current = decryptJson<{ secret: string }>(row.secret).secret
    const next = input?.secret?.trim() ? input.secret.trim() : randomBytes(32).toString('hex')
    if (next.length < 16) throw badRequest('WEAK_SECRET', 'Replacement webhook secret must be at least 16 characters')
    const [updated] = await db
      .update(webhookEndpoints)
      .set({
        secret: encryptJson({ secret: next }),
        secretPrev: encryptJson({ secret: current }),
        secretVersion: (row.secretVersion ?? 1) + 1,
        // Rotation is a manual operator action — clear any circuit-breaker trip.
        enabled: true,
        status: 'active',
        updatedAt: new Date()
      })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.merchantId, merchantId)))
      .returning()
    return { endpoint: this.maskEndpoint(updated), secret: next }
  }

  static retryDelivery = async (db: DB, merchantId: string, id: string) =>
    OutboundWebhooksService.replayDelivery(db, merchantId, id)

  /**
   * Replay a single dead-lettered/failed delivery: clears `deadLetteredAt`,
   * resets attempts and re-queues as pending. Also covers legacy `retry`
   * callers (pending/processing/failed/skipped); completed deliveries cannot
   * be replayed.
   */
  static replayDelivery = async (db: DB, merchantId: string, id: string) => {
    const delivery = await this.getDelivery(db, merchantId, id)
    if (delivery.status === 'completed') {
      throw badRequest('DELIVERY_COMPLETED', 'Completed deliveries cannot be replayed')
    }
    const endpoint = await this.getEndpoint(db, merchantId, delivery.endpointId)
    if (!endpoint.enabled) throw badRequest('ENDPOINT_DISABLED', 'Webhook endpoint is disabled')

    const [updated] = await db
      .update(webhookDeliveries)
      .set({
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(),
        lastError: null,
        deadLetteredAt: null,
        responseCode: null,
        responseBody: null
      })
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.merchantId, merchantId)))
      .returning()
    return updated
  }

  /** Replay every dead-lettered delivery (deadLetteredAt set) for the merchant. */
  static replayAllDead = async (db: DB, merchantId: string) => {
    const rows = await db
      .update(webhookDeliveries)
      .set({
        status: 'pending',
        attempts: 0,
        nextRetryAt: new Date(),
        lastError: null,
        deadLetteredAt: null,
        responseCode: null,
        responseBody: null
      })
      .where(and(eq(webhookDeliveries.merchantId, merchantId), isNotNull(webhookDeliveries.deadLetteredAt)))
      .returning({ id: webhookDeliveries.id })
    return { replayed: rows.length }
  }

  static listJobs = async (db: DB, merchantId: string) => {
    return db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.merchantId, merchantId))
      .orderBy(desc(backgroundJobs.createdAt))
  }

  static getJob = async (db: DB, merchantId: string, id: string) => {
    const [row] = await db
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.merchantId, merchantId)))
    if (!row) throw notFound('JOB_NOT_FOUND', 'Background job not found')
    return row
  }
}
