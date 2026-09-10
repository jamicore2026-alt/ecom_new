import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, isNull, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { orders, outlets as outletsTable, userOutlets, users } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const jh = { 'Content-Type': 'application/json' }

const loginAs = async (email: string, password = 'password123') => {
  const res = await call('/api/auth/login', {
    method: 'POST',
    headers: jh,
    body: JSON.stringify({ email, password })
  })
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

describe('commerce order outlet isolation (P2)', () => {
  let merchantId: string
  let admin: Record<string, string> = {}
  let scopeB: Record<string, string> = {}
  let mainOutletId = ''
  let branchOutletId = ''
  let menuItemId = ''
  let mainOrderId = ''
  let branchOrderId = ''
  let ecOrderId = ''
  const scopeBUser = { id: '' }

  const createFoodOrder = (headers: Record<string, string>, outletId: string) =>
    call('/api/food-orders', {
      method: 'POST',
      headers: { ...headers, ...jh, 'x-outlet-id': outletId },
      body: JSON.stringify({
        orderType: 'POS',
        outletId,
        items: [{ menuItemId: menuItemId, quantity: 1 }]
      })
    })

  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')

    const [merchant] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com'))
    merchantId = merchant.merchantId

    const outs = await call('/api/outlets', { headers: admin })
    mainOutletId = outs.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    // Branch outlet C + a staff user scoped ONLY to C.
    const branchRes = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: 'Branch C', code: 'BRC', status: 'active' })
    })
    expect(branchRes.status).toBe(200)
    branchOutletId = branchRes.body.data.id

    const staff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Scoped C',
        email: 'scope-c@jamicore.com',
        password: 'scope-pass-123456',
        role: 'staff',
        permissions: ['orders.read', 'orders.create', 'orders.update', 'orders.cancel']
      })
    })
    expect(staff.status).toBe(200)
    scopeBUser.id = staff.body.data.id

    const assigned = await call(`/api/user-outlets/${scopeBUser.id}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletIds: [branchOutletId] })
    })
    expect(assigned.status).toBe(200)

    scopeB = await loginAs('scope-c@jamicore.com', 'scope-pass-123456')

    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id

    // One POS order per branch, both created by admin on the shared orders table.
    const mainOrder = await createFoodOrder(admin, mainOutletId)
    expect(mainOrder.status).toBe(200)
    mainOrderId = mainOrder.body.data.id

    const branchOrder = await createFoodOrder(scopeB, branchOutletId)
    expect(branchOrder.status).toBe(200)
    branchOrderId = branchOrder.body.data.id

    // A seeded online (ecommerce) order — merchant-wide, outletId IS NULL.
    const [ec] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.status, 'pending'), isNull(orders.outletId)))
      .limit(1)
    expect(ec).toBeDefined()
    ecOrderId = ec.id
  })

  it('lists only in-scope branch orders plus merchant-wide (online) orders', async () => {
    const res = await call('/api/orders', { headers: scopeB })
    expect(res.status).toBe(200)
    const ids = res.body.data.items.map((o: { id: string }) => o.id)
    expect(ids).toContain(branchOrderId)
    expect(ids).not.toContain(mainOrderId)

    // Online (outletId null) orders belong to the merchant, not a branch —
    // they stay visible to branch-scoped staff (queried by status to avoid
    // page-depth flakiness).
    const online = await call('/api/orders?status=pending&limit=100', { headers: scopeB })
    expect(online.status).toBe(200)
    const onlineIds = online.body.data.items.map((o: { id: string }) => o.id)
    expect(onlineIds).toContain(ecOrderId)

    const adminRes = await call('/api/orders', { headers: admin })
    const adminIds = adminRes.body.data.items.map((o: { id: string }) => o.id)
    expect(adminRes.status).toBe(200)
    expect(adminIds).toContain(mainOrderId)
    expect(adminIds).toContain(branchOrderId)
  })

  it('denies row-level reads of out-of-scope branch orders', async () => {
    const denied = await call(`/api/orders/${mainOrderId}`, { headers: scopeB })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('OUTLET_SCOPE')

    const allowed = await call(`/api/orders/${ecOrderId}`, { headers: scopeB })
    expect(allowed.status).toBe(200)
    expect(allowed.body.data.id).toBe(ecOrderId)
  })

  it('denies writes to out-of-scope branch orders', async () => {
    const status = await call(`/api/orders/${mainOrderId}/status`, {
      method: 'PATCH',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'processing' })
    })
    expect(status.status).toBe(403)
    expect(status.body.error.code).toBe('OUTLET_SCOPE')

    const cancelled = await call(`/api/orders/${mainOrderId}/cancel`, { method: 'POST', headers: scopeB })
    expect(cancelled.status).toBe(403)
    expect(cancelled.body.error.code).toBe('OUTLET_SCOPE')

    // The MAIN order was never mutated by the scoped user.
    const [order] = await db.select().from(orders).where(and(eq(orders.id, mainOrderId)))
    expect(order.status).toBe('CREATED')
  })

  it('allows processing merchant-wide (online) orders inside scope', async () => {
    const res = await call(`/api/orders/${ecOrderId}/status`, {
      method: 'PATCH',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'processing' })
    })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('processing')
  })

  it('filters the CSV export by branch scope', async () => {
    const mainDetail = await call(`/api/orders/${mainOrderId}`, { headers: admin })
    const branchDetail = await call(`/api/orders/${branchOrderId}`, { headers: admin })
    const mainNumber = mainDetail.body.data.orderNumber
    const branchNumber = branchDetail.body.data.orderNumber

    const res = await app.handle(new Request('http://localhost/api/orders/export', { headers: scopeB }))
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).toContain(branchNumber)
    expect(csv).not.toContain(mainNumber)
  })

  afterAll(async () => {
    const [merchant] = await db.select().from(users).where(eq(users.email, 'scope-c@jamicore.com'))
    if (merchant) {
      await db.delete(userOutlets).where(eq(userOutlets.userId, merchant.id))
      await db.delete(users).where(eq(users.id, merchant.id))
    }
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#F%')))
    await db.delete(outletsTable).where(eq(outletsTable.id, branchOutletId))
  })
})