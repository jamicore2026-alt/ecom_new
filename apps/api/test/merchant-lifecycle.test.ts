import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { merchants, users } from '../src/database/schema'
import {
  MERCHANT_STATUSES,
  MERCHANT_LIFECYCLE,
  OPERATE_STATUSES,
  PUBLIC_STATUSES,
  assertTransition,
  IllegalMerchantTransition,
  isMerchantStatus,
  isOperational,
  isPubliclyServable,
  nextStatuses,
  type MerchantStatus
} from '../src/shared/merchant-lifecycle'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const jh = { 'Content-Type': 'application/json' }

const login = () =>
  call('/api/auth/login', {
    method: 'POST',
    headers: jh,
    body: JSON.stringify({ email: 'admin@jamicore.com', password: 'password123' })
  })

describe('merchant lifecycle state machine (P0-4)', () => {
  let merchantId = ''
  let slug = ''

  beforeAll(async () => {
    const [user] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com'))
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, user.merchantId))
    merchantId = merchant.id
    slug = merchant.slug
  })

  afterAll(async () => {
    // Restore the seed merchant to the operable state no matter what failed.
    await db.update(merchants).set({ status: 'active' }).where(eq(merchants.id, merchantId))
  })

  describe('model', () => {
    it('defines the seven canonical lifecycle states', () => {
      expect(MERCHANT_STATUSES).toEqual([
        'pending',
        'trialing',
        'active',
        'past_due',
        'suspended',
        'cancelled',
        'archived'
      ])
    })

    it('covers every documented transition from the SaaS audit', () => {
      const edges = MERCHANT_LIFECYCLE.map((t) => `${t.from}->${t.to}`).sort()
      expect(edges).toEqual(
        [
          'pending->trialing',
          'trialing->active',
          'trialing->cancelled',
          'active->past_due',
          'past_due->active',
          'past_due->suspended',
          'active->cancelled',
          'cancelled->archived',
          'any->suspended'
        ].sort()
      )
    })

    it('accepts only operable statuses as operational', () => {
      for (const s of MERCHANT_STATUSES) {
        expect(isOperational(s)).toBe(OPERATE_STATUSES.includes(s))
      }
      expect(isOperational('active')).toBe(true)
      expect(isOperational('trialing')).toBe(true)
      expect(isOperational('past_due')).toBe(true)
      expect(isOperational('pending')).toBe(false)
      expect(isOperational('suspended')).toBe(false)
      expect(isOperational('cancelled')).toBe(false)
      expect(isOperational('archived')).toBe(false)
    })

    it('serves only active merchants publicly', () => {
      for (const s of MERCHANT_STATUSES) {
        expect(isPubliclyServable(s)).toBe(PUBLIC_STATUSES.includes(s))
      }
      expect(isPubliclyServable('cancelled')).toBe(false)
    })

    it('rejects illegal transitions and accepts the legal ones', () => {
      expect(() => assertTransition('active', 'archived')).toThrow(IllegalMerchantTransition)
      expect(() => assertTransition('pending', 'active')).toThrow(IllegalMerchantTransition)
      expect(() => assertTransition('archived', 'active')).toThrow(IllegalMerchantTransition)
      expect(() => assertTransition('unknown', 'active')).toThrow(IllegalMerchantTransition)

      expect(assertTransition('pending', 'trialing').requiredEffect).toMatch(/provision/)
      expect(assertTransition('active', 'past_due').trigger).toMatch(/payment failure/)
      expect(assertTransition('any', 'suspended').trigger).toMatch(/admin action/)
    })

    it('nextStatuses follows the transition table', () => {
      expect(nextStatuses('active').sort()).toEqual(['cancelled', 'past_due', 'suspended'])
      expect(nextStatuses('cancelled')).toEqual(['archived', 'suspended'])
    })

    it('type-guards known statuses', () => {
      expect(isMerchantStatus('active')).toBe(true)
      expect(isMerchantStatus('ATTACKED')).toBe(false)
      const cast: MerchantStatus = 'archived'
      expect(cast).toBe('archived')
    })
  })

  describe('enforcement', () => {
    it('suspended merchant cannot log in', async () => {
      await db.update(merchants).set({ status: 'suspended' }).where(eq(merchants.id, merchantId))
      const res = await login()
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
      expect(res.body.error.message).toMatch(/not active/i)
    })

    it('token issued before suspension is rejected on the next request', async () => {
      // Issue a valid token while active.
      await db.update(merchants).set({ status: 'active' }).where(eq(merchants.id, merchantId))
      const { body } = await login()
      const authorization = `Bearer ${body.data.accessToken}`

      // Suspend, then reuse the pre-suspension token: must be rejected.
      await db.update(merchants).set({ status: 'suspended' }).where(eq(merchants.id, merchantId))
      const res = await call('/api/outlets', { headers: { authorization } })
      expect(res.status).toBe(401)
    })

    it('past_due merchant remains operational during the grace period', async () => {
      await db.update(merchants).set({ status: 'past_due' }).where(eq(merchants.id, merchantId))
      const { body } = await login()
      expect(body.data.merchant.status).toBe('past_due')
      const authorization = `Bearer ${body.data.accessToken}`
      const res = await call('/api/outlets', { headers: { authorization } })
      expect(res.status).toBe(200)
    })

    it('cancelled merchant is not served by the public storefront', async () => {
      await db.update(merchants).set({ status: 'active' }).where(eq(merchants.id, merchantId))
      const before = await call(`/api/store/${slug}/store`)
      expect(before.status).toBe(200)

      await db.update(merchants).set({ status: 'cancelled' }).where(eq(merchants.id, merchantId))
      const after = await call(`/api/store/${slug}/store`)
      expect(after.status).toBe(404)
    })
  })
})