import { describe, expect, it, beforeAll } from 'bun:test'
import { hash } from 'bcryptjs'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { eq } from 'drizzle-orm'
import { drivers, users } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const jsonHeaders = { 'Content-Type': 'application/json' }

async function loginAs(email: string) {
  const res = await call('/api/auth/login', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password: 'password123' })
  })
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

let admin: Record<string, string> = {}
let resOutletId = ''
let menuItemId = ''
const stamp = Date.now().toString(36)
const driverEmail = `minorgap-driver-${stamp}@test.test`
let driverId = ''

async function ensureDriver() {
  const list = await call('/api/drivers?limit=1', { headers: admin })
  const existing = list.body?.data?.items?.[0]
  if (existing) return existing.id as string
  const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com')).limit(1)
  const [user] = await db
    .insert(users)
    .values({
      merchantId: adminUser.merchantId,
      name: 'Minor Gap Driver',
      email: driverEmail,
      passwordHash: await hash('password123', 10),
      role: 'driver',
      permissions: ['delivery.read', 'drivers.read'],
      status: 'active'
    })
    .returning()
  const rec = await call('/api/drivers', {
    method: 'POST',
    headers: { ...admin, ...jsonHeaders },
    body: JSON.stringify({ userId: user.id, name: 'Minor Gap Driver', assignedOutletId: resOutletId })
  })
  expect(rec.status).toBe(200)
  return rec.body.data.id as string
}

describe('Orders/restaurant minor gaps', () => {
  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    const outlets = await call('/api/outlets', { headers: admin })
    resOutletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id
    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id
    driverId = await ensureDriver()
    await call(`/api/drivers/${driverId}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ONLINE' })
    }).catch(() => null)
  }, 20000)

  it('KDS search matches orderNumber partially (ilike)', async () => {
    const order = await call('/api/food-orders', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DINE_IN', outletId: resOutletId, items: [{ menuItemId, quantity: 1 }] })
    })
    expect(order.status).toBe(200)
    const orderNumber = order.body.data.orderNumber as string
    await call(`/api/kitchen/orders/${order.body.data.id}/tickets`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({})
    })
    const partial = orderNumber.slice(0, Math.max(3, orderNumber.length - 2))
    const res = await call(`/api/kitchen/tickets?search=${encodeURIComponent(partial)}`, { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data.items.some((t: { orderNumber: string }) => t.orderNumber === orderNumber)).toBe(true)
  })

  it('delivery create accepts a full optional-fields address object', async () => {
    const order = await call('/api/food-orders', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DELIVERY', outletId: resOutletId, items: [{ menuItemId, quantity: 1 }] })
    })
    expect(order.status).toBe(200)
    const created = await call('/api/deliveries', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({
        orderId: order.body.data.id,
        address: {
          name: 'Jane Doe',
          line1: '12 King Fahd Rd',
          city: 'Riyadh',
          state: 'Riyadh',
          postalCode: '12211',
          country: 'SA',
          phone: '+966500000000',
          lat: 24.7136,
          lng: 46.6753
        }
      })
    })
    expect(created.status).toBe(200)
    expect(created.body.data.address).toMatchObject({ name: 'Jane Doe', city: 'Riyadh', country: 'SA' })
  })

  it('driver metrics returns performance from delivery history (404 for unknown)', async () => {
    const missing = await call('/api/drivers/does-not-exist/metrics', { headers: admin })
    expect(missing.status).toBe(404)

    const before = await call(`/api/drivers/${driverId}/metrics`, { headers: admin })
    expect(before.status).toBe(200)
    for (const k of ['totalAssigned', 'activeCount', 'completedCount', 'failedCount']) {
      expect(Number.isInteger(before.body.data[k])).toBe(true)
    }
    expect(before.body.data.avgHandleMin === null || typeof before.body.data.avgHandleMin === 'number').toBe(true)
    expect(before.body.data.onTimePct === null || typeof before.body.data.onTimePct === 'number').toBe(true)

    // Run one delivery to POD so the completed/on-time path is exercised.
    const order = await call('/api/food-orders', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DELIVERY', outletId: resOutletId, items: [{ menuItemId, quantity: 1 }] })
    })
    expect(order.status).toBe(200)
    const created = await call('/api/deliveries', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderId: order.body.data.id })
    })
    expect(created.status).toBe(200)
    const deliveryId = created.body.data.id as string
    const assigned = await call(`/api/deliveries/${deliveryId}/assign`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ driverId })
    })
    expect(assigned.status).toBe(200)
    for (const s of ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED']) {
      const step = await call(`/api/deliveries/${deliveryId}/status`, {
        method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: s })
      })
      expect(step.status).toBe(200)
    }
    const pod = await call(`/api/deliveries/${deliveryId}/pod`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ note: 'metrics probe' })
    })
    expect(pod.status).toBe(200)

    const after = await call(`/api/drivers/${driverId}/metrics`, { headers: admin })
    expect(after.status).toBe(200)
    expect(after.body.data.completedCount).toBeGreaterThanOrEqual(before.body.data.completedCount + 1)
    expect(typeof after.body.data.avgHandleMin).toBe('number')
    expect(typeof after.body.data.onTimePct).toBe('number')
  })
})
