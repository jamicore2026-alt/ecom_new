import { dispatchWebhookEvent } from './webhook-delivery'
import { createLogger } from './logger'
import { db } from '../database/client'

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