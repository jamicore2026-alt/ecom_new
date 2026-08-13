import { describe, expect, it } from 'bun:test'
import { app } from '../src/app'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const jsonHeaders = { 'Content-Type': 'application/json' }

describe('Merchant Dashboard API smoke test', () => {
  let token = ''
  let auth: Record<string, string> = {}

  it('rejects protected route without a token', async () => {
    const res = await call('/api/overview')
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('rejects login with bad credentials', async () => {
    const res = await call('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email: 'admin@acme.com', password: 'wrong-password' })
    })
    expect(res.status).toBe(401)
  })

  it('logs in with the seeded admin', async () => {
    const res = await call('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email: 'admin@acme.com', password: 'password123' })
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.accessToken).toBeString()
    token = res.body.data.accessToken
    auth = { authorization: `Bearer ${token}` }
  })

  it('returns the current session', async () => {
    const res = await call('/api/auth/me', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe('admin@acme.com')
    expect(res.body.data.merchant.slug).toBe('acme-store')
  })

  it('returns overview KPIs + 30-day chart', async () => {
    const res = await call('/api/overview', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('todaySales')
    expect(res.body.data.salesChart).toHaveLength(30)
    expect(res.body.data.pendingOrders).toBeNumber()
  })

  it('lists all 20 seeded products', async () => {
    const res = await call('/api/products', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data.meta.total).toBe(20)
    expect(res.body.data.items[0]).toHaveProperty('stock')
  })

  it('filters products by status', async () => {
    const res = await call('/api/products?status=archived', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data.meta.total).toBe(0)
  })

  it('lists orders with status filter', async () => {
    const res = await call('/api/orders?status=delivered', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThan(0)
    expect(res.body.data.items[0].status).toBe('delivered')
  })

  it('returns inventory low-stock items', async () => {
    const res = await call('/api/inventory/low-stock', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThan(0)
  })

  it('returns customers', async () => {
    const res = await call('/api/customers', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data.meta.total).toBe(40)
  })

  it('returns coupons and promotions', async () => {
    const coupons = await call('/api/coupons?status=active', { headers: auth })
    const promos = await call('/api/promotions', { headers: auth })
    expect(coupons.body.data.meta.total).toBe(4)
    expect(promos.body.data.meta.total).toBe(3)
  })

  it('returns analytics sales', async () => {
    const res = await call('/api/analytics/sales?interval=week', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('revenue')
    expect(res.body.data).toHaveProperty('comparison')
  })

  it('returns analytics conversion funnel', async () => {
    const res = await call('/api/analytics/conversion', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('conversionRate')
    expect(res.body.data.byChannel.length).toBe(5)
  })

  it('returns store settings for admin', async () => {
    const res = await call('/api/settings/store', { headers: auth })
    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Acme Store')
  })

  it('creates and validates a coupon', async () => {
    const code = `TEST${Date.now().toString().slice(-8)}`

    const created = await call('/api/coupons', {
      method: 'POST',
      headers: { ...auth, ...jsonHeaders },
      body: JSON.stringify({ code, type: 'percentage', value: 10, minSubtotal: 25 })
    })
    expect(created.status).toBe(200)
    expect(created.body.data.code).toBe(code)

    const dup = await call('/api/coupons', {
      method: 'POST',
      headers: { ...auth, ...jsonHeaders },
      body: JSON.stringify({ code: code.toLowerCase(), type: 'percentage', value: 5 })
    })
    expect(dup.status).toBe(409)

    await call(`/api/coupons/${created.body.data.id}`, { method: 'DELETE', headers: auth })
  })

  it('rotates refresh tokens and revokes the old one', async () => {
    const login = await call('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email: 'admin@acme.com', password: 'password123' })
    })
    const oldRefresh = login.body.data.refreshToken
    const oldAccess = login.body.data.accessToken

    const rotated = await call('/api/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: oldRefresh })
    })
    expect(rotated.status).toBe(200)
    expect(rotated.body.data.accessToken).toBeString()
    expect(rotated.body.data.refreshToken).not.toBe(oldRefresh)

    // The old refresh token must be rejected after rotation
    const replay = await call('/api/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: oldRefresh })
    })
    expect(replay.status).toBe(401)

    // Logout revokes the shared jti, so the access token must stop working
    const revoke = await call('/api/auth/logout', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: rotated.body.data.refreshToken })
    })
    expect(revoke.status).toBe(200)

    const me = await call('/api/auth/me', {
      headers: { authorization: `Bearer ${rotated.body.data.accessToken}` }
    })
    expect(me.status).toBe(401)
    expect(me.body.error.code).toBe('UNAUTHORIZED')

    // Cleanup: the old access token was never revoked by design (separate session)
    await call('/api/auth/logout', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: oldRefresh })
    })
  })

  it('blocks staff-only area for non-admin (owner login bypasses, staff does not)', async () => {
    const login = await call('/api/auth/login', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ email: 'staff@acme.com', password: 'password123' })
    })
    const staffAuth = { authorization: `Bearer ${login.body.data.accessToken}` }
    const res = await call('/api/settings/store', { headers: staffAuth })
    expect(res.status).toBe(403)
  })
})
