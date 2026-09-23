import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { OutboundWebhooksService } from '../src/modules/outbound-webhooks/service'
import { signWebhookPayload } from '../src/shared/outbound-webhook'
import {
  buildDeliveryUrl,
  computeRetryDelayMs,
  isRetryableStatus,
  parseRetryAfterMs,
  verifyWebhookSignature
} from '../src/shared/webhook-delivery'
import { HttpError } from '../src/shared/errors'

const valid = {
  name: 'Orders API',
  url: 'https://orders.example.com/hook',
  secret: 's3cret-value',
  events: ['order.created']
}

describe('outbound webhook endpoint schema', () => {
  test('accepts a valid endpoint with known events', () => {
    expect(Value.Check(OutboundWebhooksService.endpointBodySchema, valid)).toBe(true)
    expect(
      Value.Check(OutboundWebhooksService.endpointBodySchema, {
        ...valid,
        enabled: false,
        events: ['order.created', 'refund.completed']
      })
    ).toBe(true)
  })

  test('rejects an endpoint with an unknown event', () => {
    expect(
      Value.Check(OutboundWebhooksService.endpointBodySchema, {
        ...valid,
        events: ['does.not.exist']
      })
    ).toBe(false)
  })

  test('rejects missing required fields', () => {
    expect(Value.Check(OutboundWebhooksService.endpointBodySchema, { ...valid, url: undefined })).toBe(false)
    expect(Value.Check(OutboundWebhooksService.endpointBodySchema, { ...valid, secret: undefined })).toBe(false)
    expect(Value.Check(OutboundWebhooksService.endpointBodySchema, { ...valid, events: undefined })).toBe(false)
    expect(Value.Check(OutboundWebhooksService.endpointBodySchema, { ...valid, name: '' })).toBe(false)
  })
})

describe('endpoint URL policy (HTTPS-only except localhost)', () => {
  test('accepts https URLs', () => {
    expect(() => OutboundWebhooksService.assertHttpsExceptLocalhost('https://orders.example.com/hook')).not.toThrow()
  })

  test('accepts http only for loopback hosts', () => {
    for (const url of [
      'http://localhost:3000/hook',
      'http://127.0.0.1:3000/hook',
      'http://[::1]:3000/hook'
    ]) {
      expect(() => OutboundWebhooksService.assertHttpsExceptLocalhost(url), url).not.toThrow()
    }
  })

  test('rejects http for public hosts with INSECURE_URL', () => {
    let err: unknown
    try {
      OutboundWebhooksService.assertHttpsExceptLocalhost('http://orders.example.com/hook')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).code).toBe('INSECURE_URL')
  })

  test('rejects unparseable and non-http(s) URLs', () => {
    for (const url of ['not-a-url', 'ftp://orders.example.com/hook', '']) {
      let err: unknown
      try {
        OutboundWebhooksService.assertHttpsExceptLocalhost(url)
      } catch (e) {
        err = e
      }
      expect(err, url).toBeInstanceOf(HttpError)
    }
  })
})

describe('buildDeliveryUrl', () => {
  test('builds public https URLs, rejects public http (no allowHttp hatch)', () => {
    expect(buildDeliveryUrl('https://example.com/hook').hostname).toBe('example.com')
    expect(() => buildDeliveryUrl('http://example.com/hook')).toThrow()
  })

  test('allows loopback http for local dev', () => {
    expect(buildDeliveryUrl('http://localhost:3000/hook').hostname).toBe('localhost')
    expect(buildDeliveryUrl('http://127.0.0.1:3000/hook').hostname).toBe('127.0.0.1')
  })
})

describe('isRetryableStatus (4xx no-retry)', () => {
  test('terminal 4xx are not retried', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableStatus(status), String(status)).toBe(false)
    }
  })

  test('408 and 429 are retried', () => {
    expect(isRetryableStatus(408)).toBe(true)
    expect(isRetryableStatus(429)).toBe(true)
  })

  test('5xx and other statuses are retried', () => {
    for (const status of [500, 502, 503, 599]) {
      expect(isRetryableStatus(status), String(status)).toBe(true)
    }
  })
})

describe('parseRetryAfterMs', () => {
  test('parses delay-seconds', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000)
    expect(parseRetryAfterMs('0')).toBe(0)
  })

  test('returns null for absent/invalid values', () => {
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs(undefined)).toBeNull()
    expect(parseRetryAfterMs('soon')).toBeNull()
  })

  test('parses HTTP-dates relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:02:00 GMT', now)).toBe(120_000)
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:00 GMT', now + 60_000)).toBe(0)
  })
})

describe('computeRetryDelayMs (exponential + full jitter)', () => {
  test('zero draw yields zero delay, near-one draw approaches the ceiling', () => {
    expect(computeRetryDelayMs(1, { baseMs: 30_000, capMs: 3_600_000, rand: () => 0 })).toBe(0)
    expect(computeRetryDelayMs(1, { baseMs: 30_000, capMs: 3_600_000, rand: () => 0.999 })).toBeLessThanOrEqual(30_000)
    expect(computeRetryDelayMs(1, { baseMs: 30_000, capMs: 3_600_000, rand: () => 0.999 })).toBeGreaterThan(29_000)
  })

  test('ceiling doubles per attempt and is capped', () => {
    const almostOne = () => 0.999999
    expect(computeRetryDelayMs(2, { baseMs: 30_000, capMs: 3_600_000, rand: almostOne })).toBeLessThanOrEqual(60_000)
    expect(computeRetryDelayMs(10, { baseMs: 30_000, capMs: 100_000, rand: almostOne })).toBeLessThanOrEqual(100_000)
  })

  test('Retry-After wins but is capped', () => {
    expect(computeRetryDelayMs(1, { retryAfterMs: 5_000 })).toBe(5_000)
    expect(computeRetryDelayMs(1, { capMs: 100_000, retryAfterMs: 9_999_999 })).toBe(100_000)
    expect(computeRetryDelayMs(1, { retryAfterMs: -50 })).toBe(0)
  })
})

describe('verifyWebhookSignature (dual-secret rotation)', () => {
  const payload = { order: 1 }
  const ts = 1_700_000_000_000

  test('accepts signatures from the current secret', () => {
    const sig = signWebhookPayload(payload, 'current-secret', ts)
    expect(verifyWebhookSignature(payload, ts, sig, ['current-secret', 'prev-secret'])).toBe(true)
  })

  test('accepts signatures from the previous (rotating-out) secret', () => {
    const sig = signWebhookPayload(payload, 'prev-secret', ts)
    expect(verifyWebhookSignature(payload, ts, sig, ['current-secret', 'prev-secret'])).toBe(true)
  })

  test('rejects unknown secrets and tampered payloads', () => {
    const sig = signWebhookPayload(payload, 'current-secret', ts)
    expect(verifyWebhookSignature(payload, ts, sig, ['other-secret', null])).toBe(false)
    expect(verifyWebhookSignature(payload, ts, '0'.repeat(sig.length), ['current-secret'])).toBe(false)
    expect(verifyWebhookSignature({ order: 2 }, ts, sig, ['current-secret'])).toBe(false)
  })
})