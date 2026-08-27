import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '../database/client'
import { webhookDeliveries, webhookEndpoints } from '../database/schema'
import { signWebhookPayload } from './outbound-webhook'

/**
 * Process pending webhook deliveries with exponential backoff.
 * Called periodically by the background worker scheduler.
 */
export const processWebhookDeliveries = async (): Promise<number> => {
  const now = new Date()

  // Claim pending deliveries that are due (nextRetryAt is null or in the past)
  const pending = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        or(isNull(webhookDeliveries.nextRetryAt), lt(webhookDeliveries.nextRetryAt, now))
      )
    )
    .limit(50)

  let processed = 0
  for (const delivery of pending) {
    const [endpoint] = await db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, delivery.endpointId),
          eq(webhookEndpoints.enabled, true)
        )
      )
    if (!endpoint) {
      // Endpoint disabled or deleted — mark skipped
      await db
        .update(webhookDeliveries)
        .set({ status: 'skipped', lastError: 'Endpoint disabled or deleted' })
        .where(eq(webhookDeliveries.id, delivery.id))
      processed++
      continue
    }

    // Mark as processing
    await db
      .update(webhookDeliveries)
      .set({ status: 'processing' })
      .where(eq(webhookDeliveries.id, delivery.id))

    const attempts = delivery.attempts + 1
    const timestamp = Date.now()
    const payload = (delivery.payload ?? {}) as Record<string, unknown>
    const signature = signWebhookPayload(payload, endpoint.secret, timestamp)

    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': `t=${timestamp},s=${signature}`,
          'x-webhook-timestamp': String(timestamp),
          'x-webhook-id': delivery.id,
          'x-webhook-event': delivery.event
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      })

      const responseBody = await res.text()

      if (res.ok) {
        await db
          .update(webhookDeliveries)
          .set({
            status: 'completed',
            attempts,
            responseCode: res.status,
            responseBody: responseBody.slice(0, 2000),
            sentAt: new Date()
          })
          .where(eq(webhookDeliveries.id, delivery.id))

        // Touch lastDeliveryAt on the endpoint
        await db
          .update(webhookEndpoints)
          .set({ lastDeliveryAt: new Date(), updatedAt: new Date() })
          .where(eq(webhookEndpoints.id, endpoint.id))

        processed++
        continue
      }

      // Non-2xx — schedule retry (exponential backoff: 30s, 1m, 5m, 15m, 1h)
      const backoff = [30_000, 60_000, 300_000, 900_000, 3_600_000]
      const delay = backoff[Math.min(attempts - 1, backoff.length - 1)]
      const nextRetry = new Date(Date.now() + delay)
      const maxAttempts = 5

      if (attempts >= maxAttempts) {
        await db
          .update(webhookDeliveries)
          .set({
            status: 'failed',
            attempts,
            responseCode: res.status,
            responseBody: responseBody.slice(0, 2000),
            lastError: `HTTP ${res.status}: ${responseBody.slice(0, 300)}`
          })
          .where(eq(webhookDeliveries.id, delivery.id))
      } else {
        await db
          .update(webhookDeliveries)
          .set({
            status: 'pending',
            attempts,
            responseCode: res.status,
            responseBody: responseBody.slice(0, 2000),
            lastError: responseBody.slice(0, 300),
            nextRetryAt: nextRetry
          })
          .where(eq(webhookDeliveries.id, delivery.id))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook delivery failed'
      const backoff = [30_000, 60_000, 300_000, 900_000, 3_600_000]
      const delay = backoff[Math.min(attempts - 1, backoff.length - 1)]
      const maxAttempts = 5

      if (attempts >= maxAttempts) {
        await db
          .update(webhookDeliveries)
          .set({ status: 'failed', attempts, lastError: message, nextRetryAt: null })
          .where(eq(webhookDeliveries.id, delivery.id))
      } else {
        await db
          .update(webhookDeliveries)
          .set({
            status: 'pending',
            attempts,
            lastError: message,
            nextRetryAt: new Date(Date.now() + delay)
          })
          .where(eq(webhookDeliveries.id, delivery.id))
      }
    }
    processed++
  }

  return processed
}

/**
 * Queue an outbound webhook event for delivery to all matching endpoints.
 */
export const dispatchWebhookEvent = async (
  merchantId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<number> => {
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.merchantId, merchantId), eq(webhookEndpoints.enabled, true)))

  let queued = 0
  for (const endpoint of endpoints) {
    const events: string[] = endpoint.events ?? []
    if (!events.includes(event) && !events.includes('*')) continue

    await db.insert(webhookDeliveries).values({
      merchantId,
      endpointId: endpoint.id,
      event,
      payload,
      status: 'pending',
      attempts: 0,
      createdAt: new Date()
    })
    queued++
  }
  return queued
}
