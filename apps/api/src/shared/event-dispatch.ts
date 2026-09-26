import { and, desc, eq, isNull, lte, or } from 'drizzle-orm'
import { dispatchWebhookEvent } from './webhook-delivery'
import { createLogger } from './logger'
import { db, type DB } from '../database/client'
import { backgroundJobs } from '../database/schema'

const log = createLogger('events')

/**
 * Fire-and-forget outbound webhook dispatch so the caller's hot path
 * (checkout, refund, order transitions) is never blocked by delivery.
 *
 * Dispatch runs on the platform admin connection, never on a request-scoped
 * tenant connection: it happens after the handler returns, so a tenant
 * connection would already be closed and the event would be dropped.
 */
export const emit = (
  merchantId: string,
  event: string,
  payload: Record<string, unknown>
): void => {
  dispatchWebhookEvent(db, merchantId, event, payload).catch((err) => {
    log.error(`failed to queue ${event}`, err)
  })
}

/* ---------------------------------------------------------------------------
 * Best-effort transactional outbox on the existing `background_jobs` table
 * (NO schema change — see note below).
 *
 * Durable path for callers that CAN await and CAN pass their transaction:
 *   await db.transaction(async (tx) => {
 *     ... business writes ...
 *     await emitOutbox(tx, merchantId, 'order.paid', payload);
 *   });
 * The outbox row commits atomically with the business writes; the background
 * worker (drainOutbox, wired into runJobWorker) later fans it out into
 * webhook_deliveries. Crashed-before-drain rows are retried, not lost —
 * unlike the fire-and-forget `emit()` above, which can drop events if the
 * process dies between commit and queue-insert.
 *
 * WHY "best-effort" / what was SKIPPED and why: a textbook atomic outbox
 * needs (a) every producer to thread its transaction handle into the emit
 * call and (b) a dedicated outbox table with exactly-once claim semantics.
 * (a) touches ~30 call sites across checkout/orders/refunds/etc. — modules
 * explicitly out of scope for this change — and (b) needs a migration, which
 * is forbidden here. So `background_jobs` (merchantId, type, payload,
 * status, attempts, maxAttempts, nextRetryAt) is reused as the durable
 * queue: it fits (type='webhook_dispatch', payload={event, data}), is
 * visible in the existing /api/background-jobs endpoints, and retries with
 * backoff. New producers SHOULD use emitOutbox(tx,...); legacy emit()
 * callers are unchanged.
 * ------------------------------------------------------------------------- */

export const OUTBOX_JOB_TYPE = 'webhook_dispatch'
const OUTBOX_MAX_ATTEMPTS = 5

/** Durable outbox write — call with the caller's tx for atomicity. */
export const emitOutbox = async (
  database: DB,
  merchantId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<string> => {
  const [row] = await database
    .insert(backgroundJobs)
    .values({
      merchantId,
      type: OUTBOX_JOB_TYPE,
      payload: { event, data: payload },
      status: 'pending',
      attempts: 0,
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
      nextRetryAt: new Date()
    })
    .returning({ id: backgroundJobs.id })
  return row.id
}

/**
 * Worker drain: claim due `webhook_dispatch` rows and fan each out into
 * webhook_deliveries. Per-job failures increment attempts with backoff and
 * never abort the drain. Called from runJobWorker (shared/jobs-worker.ts).
 */
export const drainOutbox = async (database: DB = db, batchLimit = 50): Promise<number> => {
  const now = new Date()
  const due = await database
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.type, OUTBOX_JOB_TYPE),
        eq(backgroundJobs.status, 'pending'),
        or(isNull(backgroundJobs.nextRetryAt), lte(backgroundJobs.nextRetryAt, now))
      )
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(batchLimit)

  let drained = 0
  for (const job of due) {
    const payload = (job.payload ?? {}) as { event?: string; data?: Record<string, unknown> }
    if (!payload.event) {
      await database
        .update(backgroundJobs)
        .set({ status: 'failed', lastError: 'outbox job missing event name' })
        .where(eq(backgroundJobs.id, job.id))
      continue
    }
    const attempts = job.attempts + 1
    try {
      await dispatchWebhookEvent(
        database,
        job.merchantId,
        payload.event,
        (payload.data ?? {}) as Record<string, unknown>
      )
      await database
        .update(backgroundJobs)
        .set({ status: 'completed', attempts, completedAt: new Date() })
        .where(eq(backgroundJobs.id, job.id))
      drained++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const terminal = attempts >= (job.maxAttempts ?? OUTBOX_MAX_ATTEMPTS)
      await database
        .update(backgroundJobs)
        .set({
          status: terminal ? 'failed' : 'pending',
          attempts,
          lastError: message.slice(0, 2000),
          nextRetryAt: terminal ? null : new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** (attempts - 1)))
        })
        .where(eq(backgroundJobs.id, job.id))
      log.error('outbox drain failed', { jobId: job.id, event: payload.event, error: err })
    }
  }
  return drained
}
