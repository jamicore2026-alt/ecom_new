import { processWebhookDeliveries } from './webhook-delivery'

/**
 * Poll the webhook delivery queue periodically and run due jobs.
 */
export const runJobWorker = async (): Promise<number> => {
  return processWebhookDeliveries()
}