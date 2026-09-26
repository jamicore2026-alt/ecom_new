import { db } from '../database/client'
import { processWebhookDeliveries } from './webhook-delivery'
import { createLogger } from './logger'

const log = createLogger('jobs')

/**
 * Poll the webhook delivery queue periodically and run due jobs.
 * Growth workers (lazy-imported so webhook latency never pays for them):
 * - campaigns: send due scheduled drafts
 * - content: publish due scheduled pages
 * - reviews: post-purchase review-request emails
 */
export const runJobWorker = async (): Promise<number> => {
  const delivered = await processWebhookDeliveries()

  // Transactional-outbox drain (background_jobs type='webhook_dispatch'):
  // fans durable outbox rows into webhook_deliveries. Failures are counted
  // per job inside drainOutbox and never throw here.
  try {
    const { drainOutbox } = await import('./event-dispatch')
    const drained = await drainOutbox(db)
    if (drained > 0) log.info('drained webhook outbox', { drained })
  } catch (e) {
    log.error('webhook outbox drain failed', e)
  }

  try {
    const { CampaignsService } = await import('../modules/campaigns/service')
    const sent = await CampaignsService.sendDueScheduled(db)
    if (sent > 0) log.info('sent due campaigns', { sent })
  } catch (e) {
    log.error('campaign schedule worker failed', e)
  }

  try {
    const { ContentService } = await import('../modules/content/service')
    const published = await ContentService.publishDue(db)
    if (published > 0) log.info('published due content', { published })
  } catch (e) {
    log.error('content publish worker failed', e)
  }

  try {
    const { ReviewsService } = await import('../modules/reviews/service')
    const requested = await ReviewsService.sendDueReviewRequests(db)
    if (requested > 0) log.info('sent review requests', { requested })
  } catch (e) {
    log.error('review request worker failed', e)
  }

  // Audit retention sweep (default >365d). Runs best-effort per merchant;
  // failures are logged loudly inside AuditService.purgeExpired and never
  // throw here.
  try {
    const days = Number(process.env.AUDIT_RETENTION_DAYS ?? 365)
    const { AuditService } = await import('../modules/audit-logs/service')
    const purged = await AuditService.purgeExpired(db, days)
    if (purged > 0) log.info('purged expired audit rows', { purged, days })
  } catch (e) {
    log.error('audit retention worker failed', e)
  }

  return delivered
}
