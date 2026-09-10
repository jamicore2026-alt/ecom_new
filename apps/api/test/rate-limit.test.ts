import { afterEach, describe, expect, test } from 'bun:test'
import { closeRateLimitStore, getRateLimitStore } from '../src/shared/rate-limit'

afterEach(() => {
  delete process.env.RATE_LIMIT_STORE
  delete process.env.REDIS_URL
  delete process.env.RATE_LIMIT_ALLOW_MEMORY
  process.env.NODE_ENV = 'test'
})

describe('rate limiter', () => {
  test('memory store enforces the window, max, and reset', async () => {
    process.env.NODE_ENV = 'test'
    process.env.RATE_LIMIT_STORE = 'memory'
    const store = getRateLimitStore()
    const key = 'login:203.0.113.9'

    const first = await store.incrementAndCheck(key, 60_000, 3)
    expect(first).toEqual({ allowed: true, count: 1 })
    await store.incrementAndCheck(key, 60_000, 3)
    await store.incrementAndCheck(key, 60_000, 3)
    const over = await store.incrementAndCheck(key, 60_000, 3)
    expect(over.count).toBe(4)
    expect(over.allowed).toBe(false)

    // A separate key benefits from its own independent window.
    const other = await store.incrementAndCheck('login:198.51.100.7', 60_000, 3)
    expect(other).toEqual({ allowed: true, count: 1 })

    await store.reset(key)
    expect(await store.get(key)).toBe(0)
    await closeRateLimitStore()
  })
})