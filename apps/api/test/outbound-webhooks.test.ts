import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { OutboundWebhooksService } from '../src/modules/outbound-webhooks/service'

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