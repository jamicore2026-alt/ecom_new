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

/**
 * Verify a webhook payload's signature timing-safely.
 * Returns true if the signature matches within the tolerance window.
 */
export const verifyWebhookSignature = (
  payload: Buffer,
  signature: string,
  timestamp: number,
  secret: string,
  toleranceMs: number = 5 * 60 * 1000
): boolean => {
  // Reject if timestamp is outside tolerance window
  const now = Date.now()
  if (Math.abs(now - timestamp) > toleranceMs) {
    return false
  }

  const message = `${timestamp}.${payload.toString('utf8')}`
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex')

  // Use timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(expectedSig, 'hex'),
    Buffer.from(signature, 'hex')
  )
}

/**
 * Parse the X-Webhook-Signature header values.
 */
export interface WebhookSignature {
  timestamp: string
  signature: string
}

/**
 * Extract webhook signature from request headers.
 */
export const parseWebhookSignature = (headers: Headers): WebhookSignature | null => {
  const signatureHeader = headers.get('x-webhook-signature')
  if (!signatureHeader) return null

  const parts = signatureHeader.split(',')
  const result: WebhookSignature = {
    timestamp: '',
    signature: ''
  }

  for (const part of parts) {
    const [key, value] = part.split('=').map((s) => s.trim())
    if (key === 't') {
      result.timestamp = value
    } else if (key === 's') {
      result.signature = value
    }
  }

  if (!result.timestamp || !result.signature) return null
  return result
}

/**
 * Build the webhook response with delivery tracking.
 */
export const buildWebhookResponse = (success: boolean, deliveryId?: string) => {
  const body = success
    ? JSON.stringify({ success: true, deliveryId })
    : JSON.stringify({ success: false })

  return new Response(body, {
    status: success ? 200 : 500,
    headers: {
      'content-type': 'application/json',
    }
  })
}
