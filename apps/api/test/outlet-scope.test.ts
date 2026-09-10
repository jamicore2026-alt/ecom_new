import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, like } from 'drizzle-orm'
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

describe('food-order outlet isolation (P2)', () => {
  let merchantId: string
  let mainOutletId = ''
  let branchOutletId = ''
  const scopeBUser = { id: '' }
  let scopeB: Record<string, string> = {}
  let admin: Record<string, string> = {}
  let menuItemId = ''
  let mainOrderId = ''
  let branchOrderId = ''

  const createOrder = (headers: Record<string, string>, outletId: string, orderType = 'POS') =>
    call('/api/food-orders', {
      method: 'POST',
      headers: { ...headers, ...jh },
      body: JSON.stringify({
        orderType,
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

    // Branch outlet B + a staff user scoped ONLY to B.
    const branchRes = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: 'Branch B', code: 'BRB', status: 'active' })
    })
    expect(branchRes.status).toBe(200)
    branchOutletId = branchRes.body.data.id

    const staff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Scoped B',
        email: 'scope-b@jamicore.com',
        password: 'scope-pass-123456',
        role: 'staff',
        permissions: ['orders.read', 'orders.create', 'orders.update', 'payments.create']
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

    scopeB = await loginAs('scope-b@jamicore.com', 'scope-pass-123456')

    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id

    // Admin creates a MAIN order; the branch-scoped user creates a BRB order.
    const main = await createOrder(admin, mainOutletId)
    expect(main.status).toBe(200)
    mainOrderId = main.body.data.id

    const branchOrder = await createOrder(scopeB, branchOutletId)
    expect(branchOrder.status).toBe(200)
    branchOrderId = branchOrder.body.data.id
  })

  it('keeps an out-of-scope outletId param from widening the list', async () => {
    const res = await call('/api/food-orders?outletId=' + encodeURIComponent(mainOutletId), { headers: scopeB })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('lists only orders inside the caller\'s outlet scope', async () => {
    const res = await call('/api/food-orders', { headers: scopeB })
    expect(res.status).toBe(200)
    const ids = res.body.data.items.map((o: { id: string }) => o.id)
    expect(ids).toContain(branchOrderId)
    expect(ids).not.toContain(mainOrderId)

    const adminRes = await call('/api/food-orders', { headers: admin })
    const adminIds = adminRes.body.data.items.map((o: { id: string }) => o.id)
    expect(adminIds).toContain(mainOrderId)
  })

  it('denies single-order reads outside the caller\'s scope', async () => {
    const res = await call(`/api/food-orders/${mainOrderId}`, { headers: scopeB })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('denies writes to orders outside the caller\'s scope', async () => {
    const status = await call(`/api/food-orders/${mainOrderId}/status`, {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'CONFIRMED' })
    })
    expect(status.status).toBe(403)
    expect(status.body.error.code).toBe('OUTLET_SCOPE')

    const cancelled = await call(`/api/food-orders/${mainOrderId}/cancel`, { method: 'POST', headers: scopeB })
    expect(cancelled.status).toBe(403)
    expect(cancelled.body.error.code).toBe('OUTLET_SCOPE')

    // The MAIN order was never mutated by the scoped user.
    const [order] = await db.select().from(orders).where(eq(orders.id, mainOrderId))
    expect(order.status).toBe('CREATED')
  })

  it('rejects creating a food order for an out-of-scope outlet', async () => {
    const res = await createOrder(scopeB, mainOutletId)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('allows full lifecycle inside the caller\'s own outlet', async () => {
    const confirmed = await call(`/api/food-orders/${branchOrderId}/status`, {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'CONFIRMED' })
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.data.status).toBe('CONFIRMED')
  })

  afterAll(async () => {
    const [merchant] = await db.select().from(users).where(eq(users.email, 'scope-b@jamicore.com'))
    if (merchant) {
      await db.delete(userOutlets).where(eq(userOutlets.userId, merchant.id))
      await db.delete(users).where(eq(users.id, merchant.id))
    }
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), eq(orders.id, branchOrderId)))
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#F%')))
    await db.delete(outletsTable).where(eq(outletsTable.id, branchOutletId))
  })
})