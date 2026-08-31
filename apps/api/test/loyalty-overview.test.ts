import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { customers, loyaltyAccounts, loyaltyLedger, merchants } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const auth = async (email = 'admin@acme.com') => {
  const res = await call('/api/auth/login', json({ email, password: 'password123' }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

let merchantId: string
let customerId: string

describe('Loyalty — merchant-wide overview', () => {
  beforeAll(async () => {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    const headers = await auth()
    const res = await call('/api/customers?limit=1', { headers })
    customerId = res.body.data.items[0].id

    await call('/api/loyalty/adjust', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ customerId, points: 100, type: 'earn' })
    })
    await call('/api/loyalty/adjust', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ customerId, points: -30, type: 'redeem' })
    })
  })

  it('returns overview aggregates', async () => {
    const headers = await auth()
    const res = await call('/api/loyalty/overview', { headers })
    expect(res.status).toBe(200)
    expect(res.body.data.memberCount).toBeGreaterThanOrEqual(1)
    expect(res.body.data.totalPoints).toBeGreaterThanOrEqual(1)
    expect(res.body.data.lifetimePoints).toBeGreaterThanOrEqual(1)
    expect(res.body.data.totalRedeemed).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(res.body.data.tiers)).toBe(true)
    expect(res.body.data.tiers.some((t: any) => t.tier === 'standard')).toBe(true)
  })

  it('auto-creates an account when reading a customer (getByCustomer)', async () => {
    const headers = await auth()
    const list = await call('/api/customers?limit=2', { headers })
    const target = list.body.data.items[1]?.id
    if (!target) return
    const res = await call(`/api/loyalty/${target}`, { headers })
    expect(res.status).toBe(200)
    expect(res.body.data.customerId).toBe(target)
  })

  afterAll(async () => {
    await db.delete(loyaltyLedger).where(and(eq(loyaltyLedger.merchantId, merchantId), eq(loyaltyLedger.customerId, customerId)))
    await db.delete(loyaltyAccounts).where(and(eq(loyaltyAccounts.merchantId, merchantId), eq(loyaltyAccounts.customerId, customerId)))
  })
})