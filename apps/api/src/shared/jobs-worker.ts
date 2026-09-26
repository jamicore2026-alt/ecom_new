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

  return delivered
}
