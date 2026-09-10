import { dispatchWebhookEvent } from './webhook-delivery'
import { createLogger } from './logger'

const log = createLogger('events')

/**
 * Fire-and-forget outbound webhook dispatch so the caller's hot path
 * (checkout, refund, order transitions) is never blocked by delivery.
 */
export const emit = (merchantId: string, event: string, payload: Record<string, unknown>): void => {
  dispatchWebhookEvent(merchantId, event, payload).catch((err) => {
    log.error(`failed to queue ${event}`, err)
  })
}
