import crypto from 'crypto'

/**
 * Generate a secure HMAC signature for webhook payloads.
 * Uses the endpoint's secret + timestamp + payload for timing-safe comparison.
 */
export const signWebhookPayload = (
  payload: Record<string, unknown>,
  secret: string,
  timestamp: number
): string => {
  const message = `${timestamp}.${JSON.stringify(payload)}`
  return crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex')
}
