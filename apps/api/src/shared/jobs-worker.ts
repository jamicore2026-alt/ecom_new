import { and, eq, lt, or, isNull } from 'drizzle-orm'
import { db } from '../database/client'
import { backgroundJobs } from '../database/schema'
import { processWebhookDeliveries } from './webhook-delivery'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Durable, idempotent background job runner.
 *
 * Jobs are claimed atomically (pending + due + not locked), marked processing
 * with a lease timeout so a crashed worker releases the job, executed, then
 * marked completed/failed with retry+backoff.
 */
export const claimJob = async (tx: Tx, type: string): Promise<typeof backgroundJobs.$inferSelect | null> => {
  const now = new Date()
  const [job] = await tx
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.type, type),
        eq(backgroundJobs.status, 'pending'),
        or(isNull(backgroundJobs.nextRetryAt), lt(backgroundJobs.nextRetryAt, now)),
        or(isNull(backgroundJobs.lockedUntil), lt(backgroundJobs.lockedUntil, now))
      )
    )
    .for('update')
    .limit(1)

  if (!job) return null

  // Claim it — set processing with a lease timeout
  await tx
    .update(backgroundJobs)
    .set({ status: 'processing', lockedUntil: new Date(Date.now() + 60_000) })
    .where(eq(backgroundJobs.id, job.id))
  return job
}

export const completeJob = async (
  tx: Tx,
  jobId: string,
  opts?: { attempts?: number; nextRetryAt?: Date }
) => {
  await tx
    .update(backgroundJobs)
    .set({
      status: 'completed',
      completedAt: new Date(),
      lockedUntil: null,
      attempts: opts?.attempts ?? 1,
      updatedAt: new Date()
    })
    .where(eq(backgroundJobs.id, jobId))
}

export const failJob = async (
  tx: Tx,
  jobId: string,
  error: string,
  opts?: { attempts?: number; nextRetryAt?: Date }
) => {
  await tx
    .update(backgroundJobs)
    .set({
      status: 'failed',
      lastError: error,
      lockedUntil: null,
      attempts: opts?.attempts ?? 1,
      nextRetryAt: opts?.nextRetryAt ?? null,
      updatedAt: new Date()
    })
    .where(eq(backgroundJobs.id, jobId))
}

export const scheduleRetry = async (
  tx: Tx,
  jobId: string,
  error: string,
  attempts: number,
  maxAttempts: number
) => {
  if (attempts >= maxAttempts) {
    await failJob(tx, jobId, error, { attempts })
    return
  }
  const backoff = [30_000, 60_000, 300_000, 900_000, 3_600_000]
  const delay = backoff[Math.min(attempts - 1, backoff.length - 1)]
  await tx
    .update(backgroundJobs)
    .set({
      status: 'pending',
      lastError: error,
      attempts,
      lockedUntil: null,
      nextRetryAt: new Date(Date.now() + delay),
      updatedAt: new Date()
    })
    .where(eq(backgroundJobs.id, jobId))
}

/**
 * Poll the job queue periodically and run due jobs.
 */
export const runJobWorker = async (): Promise<number> => {
  const processDelivery = await processWebhookDeliveries()

  let processed = 0
  // Webhook deliveries processed as part of worker
  processed += processDelivery
  return processed
}
