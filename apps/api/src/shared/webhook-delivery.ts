import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '../database/client'
import { webhookDeliveries, webhookEndpoints } from '../database/schema'
import { signWebhookPayload } from './outbound-webhook'
import { decryptJson } from './crypto'
import { buildOutboundUrl } from './outbound-url'
import type { DB } from '../database/client'

export const MAX_DELIVERY_ATTEMPTS = 5
/** Base for exponential backoff (attempt 1 ceiling); doubled per attempt. */
export const RETRY_BASE_MS = 30_000
/** Upper bound for any single retry delay, including Retry-After values. */
export const RETRY_CAP_MS = 3_600_000
/** Consecutive terminal failures after which the endpoint is auto-disabled. */
export const CIRCUIT_BREAKER_FAILURES = 20

/** Hosts where plain `http://` is tolerated (local development only). */
export const isLoopbackHostname = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/**
 * HTTPS-only URL construction for deliveries. Loopback `http://` targets are
 * allowed (local dev); everything else goes through the SSRF-guarded,
 * https-only `buildOutboundUrl` with no `allowHttp` escape hatch.
 */
export const buildDeliveryUrl = (raw: string): URL => {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Webhook URL is invalid')
  }
  if (isLoopbackHostname(parsed.hostname)) {
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Webhook URL must be http(s)')
    }
    return parsed
  }
  return buildOutboundUrl(raw)
}

/**
 * 4xx responses are terminal (do not retry) except 408 (timeout) and 429
 * (rate limited), which honor backoff like 5xx / network errors.
 */
export const isRetryableStatus = (status: number): boolean => {
  if (status === 408 || status === 429) return true
  if (status >= 400 && status < 500) return false
  return true
}

/**
 * Parse a `Retry-After` response header into milliseconds. Accepts
 * delay-seconds or an HTTP-date; returns null when absent/invalid.
 * Callers clamp to RETRY_CAP_MS via `computeRetryDelayMs`.
 */
export const parseRetryAfterMs = (
  value: string | null | undefined,
  nowMs: number = Date.now()
): number | null => {
  if (!value) return null
  const v = value.trim()
  if (/^\d+$/.test(v)) {
    const seconds = Number(v)
    if (!Number.isSafeInteger(seconds)) return null
    return seconds * 1000
  }
  const when = Date.parse(v)
  if (!Number.isNaN(when)) return Math.max(0, when - nowMs)
  return null
}

/**
 * Exponential backoff with full jitter: `delay = rand * min(cap, base * 2^(attempt-1))`.
 * An explicit `retryAfterMs` (from the Retry-After header) wins, capped at `capMs`.
 * `rand` is injectable for deterministic tests.
 */
export const computeRetryDelayMs = (
  attempt: number,
  opts: { baseMs?: number; capMs?: number; retryAfterMs?: number | null; rand?: () => number } = {}
): number => {
  const base = opts.baseMs ?? RETRY_BASE_MS
  const cap = opts.capMs ?? RETRY_CAP_MS
  if (opts.retryAfterMs != null) return Math.min(Math.max(0, Math.floor(opts.retryAfterMs)), cap)
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt - 1))
  const rand = opts.rand ?? Math.random
  return Math.floor(rand() * ceiling)
}

/**
 * ============================================================================
 * CONSUMER VERIFICATION GUIDE (for integrators receiving our webhooks)
 * ----------------------------------------------------------------------------
 * Every delivery POST carries:
 *   x-webhook-id:        unique delivery id (use as idempotency key)
 *   x-webhook-event:     event name, e.g. "order.paid"
 *   x-webhook-timestamp: unix milliseconds when the payload was signed
 *   x-webhook-signature: "t=<timestamp>,s=<hex>" — hex HMAC-SHA256 of
 *                        "<timestamp>.<JSON.stringify(payload)>" keyed with
 *                        your endpoint secret.
 *
 * Verify (pseudocode):
 *   1. Parse `t` and `s` from x-webhook-signature.
 *   2. REJECT if |now - t| > 5 minutes (timestamp tolerance — blocks
 *      captured-payload replay; legitimate clock skew stays well inside).
 *   3. Recompute HMAC-SHA256("<t>.<raw request body>") with your secret and
 *      compare with `s` using a timing-safe equal (crypto.timingSafeEqual).
 *      During secret rotation BOTH the current and previous secrets verify —
 *      accept either (see rotateSecret below), preferring current.
 *   4. REPLAY protection: store seen x-webhook-id values (e.g. 24h TTL) and
 *      drop duplicates — at-least-once delivery means retries/replays reuse
 *      the same id with identical payload.
 *   5. Return 2xx only after persisting; 5xx/408/429 are retried with
 *      jittered exponential backoff (max 5 attempts, then dead-lettered).
 *      Other 4xx are terminal (no retry) — fix your endpoint instead.
 * ============================================================================
 */

/**
 * Dual-secret verification for consumers: accepts a signature produced with
 * either the current or the previous (rotating-out) secret. Timing-safe.
 */
export const verifyWebhookSignature = (
  payload: Record<string, unknown>,
  timestamp: number,
  signature: string,
  secrets: Array<string | null | undefined>
): boolean => {
  const message = `${timestamp}.${JSON.stringify(payload)}`
  let candidate: Buffer
  try {
    candidate = Buffer.from(signature, 'utf8')
  } catch {
    return false
  }
  for (const secret of secrets) {
    if (!secret) continue
    const expected = Buffer.from(createHmac('sha256', secret).update(message).digest('hex'), 'utf8')
    if (candidate.length !== expected.length) continue
    if (timingSafeEqual(candidate, expected)) return true
  }
  return false
}

/** Extract current + previous plaintext secrets for an endpoint row. */
export const endpointSecrets = (endpoint: {
  secret: string
  secretPrev: string | null
}): { current: string; prev: string | null } => {
  const current = decryptJson<{ secret: string }>(endpoint.secret).secret
  let prev: string | null = null
  if (endpoint.secretPrev) {
    try {
      prev = decryptJson<{ secret: string }>(endpoint.secretPrev).secret
    } catch {
      prev = null
    }
  }
  return { current, prev }
}

/**
 * Circuit breaker: after CIRCUIT_BREAKER_FAILURES consecutive terminal
 * failures (status failed/dead) on an endpoint, auto-disable it so a dead
 * receiver stops consuming worker cycles. A manual save (enabled=true),
 * secret rotation, or a successful delivery re-enables it.
 */
const recordFailureAndMaybeTripBreaker = async (database: DB, endpointId: string): Promise<void> => {
  const recent = await database
    .select({ status: webhookDeliveries.status })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.endpointId, endpointId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(CIRCUIT_BREAKER_FAILURES)
  if (
    recent.length >= CIRCUIT_BREAKER_FAILURES &&
    recent.every((r) => r.status === 'failed' || r.status === 'dead')
  ) {
    await database
      .update(webhookEndpoints)
      .set({ enabled: false, status: 'disabled', updatedAt: new Date() })
      .where(eq(webhookEndpoints.id, endpointId))
  }
}

/**
 * Process pending webhook deliveries with jittered exponential backoff.
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
    // New deliveries are always signed with the CURRENT secret; the previous
    // secret is only accepted when verifying inbound signatures.
    const { current: secret } = endpointSecrets(endpoint)
    const signature = signWebhookPayload(payload, secret, timestamp)

    /** Terminal failure → dead-letter queue (status failed/dead + deadLetteredAt). */
    const deadLetter = async (fields: {
      status: 'failed' | 'dead'
      responseCode?: number | null
      responseBody?: string | null
      lastError: string
    }) => {
      await db
        .update(webhookDeliveries)
        .set({
          status: fields.status,
          attempts,
          responseCode: fields.responseCode ?? null,
          responseBody: (fields.responseBody ?? '').slice(0, 2000),
          lastError: fields.lastError.slice(0, 2000),
          deadLetteredAt: new Date(),
          nextRetryAt: null
        })
        .where(eq(webhookDeliveries.id, delivery.id))
      await recordFailureAndMaybeTripBreaker(db, endpoint.id)
    }

    try {
      let url: URL
      try {
        url = buildDeliveryUrl(endpoint.url)
      } catch (err) {
        await db
          .update(webhookDeliveries)
          .set({
            status: 'skipped',
            lastError: err instanceof Error ? err.message : 'Webhook URL is invalid (SSRF blocked)'
          })
          .where(eq(webhookDeliveries.id, delivery.id))
        processed++
        continue
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': `t=${timestamp},s=${signature}`,
          'x-webhook-timestamp': String(timestamp),
          'x-webhook-id': delivery.id,
          'x-webhook-event': delivery.event
        },
        body: JSON.stringify(payload),
        redirect: 'manual',
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

        // Touch lastDeliveryAt on the endpoint; success clears any breaker trip.
        await db
          .update(webhookEndpoints)
          .set({ lastDeliveryAt: new Date(), status: 'active', updatedAt: new Date() })
          .where(eq(webhookEndpoints.id, endpoint.id))

        processed++
        continue
      }

      // Terminal 4xx (except 408/429): fail immediately into the DLQ, no retry.
      if (!isRetryableStatus(res.status)) {
        await deadLetter({
          status: 'failed',
          responseCode: res.status,
          responseBody,
          lastError: `HTTP ${res.status} (no retry): ${responseBody.slice(0, 300)}`
        })
        processed++
        continue
      }

      // Retryable (5xx / 408 / 429): honor Retry-After, else jittered backoff.
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'))
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        await deadLetter({
          status: 'dead',
          responseCode: res.status,
          responseBody,
          lastError: `HTTP ${res.status} after ${attempts} attempts: ${responseBody.slice(0, 300)}`
        })
      } else {
        await db
          .update(webhookDeliveries)
          .set({
            status: 'pending',
            attempts,
            responseCode: res.status,
            responseBody: responseBody.slice(0, 2000),
            lastError: responseBody.slice(0, 300),
            nextRetryAt: new Date(Date.now() + computeRetryDelayMs(attempts, { retryAfterMs }))
          })
          .where(eq(webhookDeliveries.id, delivery.id))
      }
    } catch (err) {
      // Network/timeout errors are retryable with jittered backoff.
      const message = err instanceof Error ? err.message : 'Webhook delivery failed'
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        await deadLetter({ status: 'dead', lastError: `${message} (after ${attempts} attempts)` })
      } else {
        await db
          .update(webhookDeliveries)
          .set({
            status: 'pending',
            attempts,
            lastError: message,
            nextRetryAt: new Date(Date.now() + computeRetryDelayMs(attempts))
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
 * `db` is the tenant-scoped connection when called from an authenticated
 * request, so RLS confines the scan to the merchant's endpoints.
 */
export const dispatchWebhookEvent = async (
  db: DB,
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
