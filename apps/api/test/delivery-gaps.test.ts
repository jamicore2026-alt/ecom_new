import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
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
const driverEmail = `gapdriver-${stamp}@test.test`
let driverAuth: Record<string, string> = {}
let driverId = ''

async function makeDelivery() {
  const order = await call('/api/food-orders', {
    method: 'POST',
    headers: { ...admin, ...jsonHeaders },
    body: JSON.stringify({ orderType: 'DELIVERY', outletId: resOutletId, items: [{ menuItemId, quantity: 1 }] })
  })
  expect(order.status).toBe(200)
  const created = await call('/api/deliveries', {
    method: 'POST',
    headers: { ...admin, ...jsonHeaders },
    body: JSON.stringify({ orderId: order.body.data.id })
  })
  expect(created.status).toBe(200)
  return created.body.data.id as string
}

async function driveTo(deliveryId: string, steps: string[]) {
  for (const s of steps) {
    const res = await call(`/api/deliveries/${deliveryId}/status`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ status: s })
    })
    expect(res.status).toBe(200)
  }
}

async function assignToDriver(deliveryId: string) {
  const res = await call(`/api/deliveries/${deliveryId}/assign`, {
    method: 'POST',
    headers: { ...admin, ...jsonHeaders },
    body: JSON.stringify({ driverId })
  })
  expect(res.status).toBe(200)
  return res
}

describe('Delivery gaps: live view, tracking, POD, failed reasons', () => {
  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    const outlets = await call('/api/outlets', { headers: admin })
    resOutletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    const mod = await call('/api/modules/delivery', {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ enabled: true })
    })
    expect(mod.status).toBe(200)

    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id

    const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com')).limit(1)
    const [user] = await db
      .insert(users)
      .values({
        merchantId: adminUser.merchantId,
        name: 'Gap Driver',
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
      body: JSON.stringify({ userId: user.id, name: 'Gap Driver', assignedOutletId: resOutletId })
    })
    expect(rec.status).toBe(200)
    driverId = rec.body.data.id
    await call(`/api/drivers/${driverId}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ONLINE' })
    })
    driverAuth = await loginAs(driverEmail)
  }, 20000)

  it('live view shows the heartbeat location with age and the active delivery', async () => {
    const loc = await call('/api/delivery/me/location', {
      method: 'POST', headers: { ...driverAuth, ...jsonHeaders }, body: JSON.stringify({ lat: 40.71, lng: -74.0 })
    })
    expect(loc.status).toBe(200)

    const deliveryId = await makeDelivery()
    await assignToDriver(deliveryId)

    const live = await call('/api/drivers/live', { headers: admin })
    expect(live.status).toBe(200)
    const me = live.body.data.find((d: { id: string }) => d.id === driverId)
    expect(me).toBeDefined()
    expect(me.lat).toBe(40.71)
    expect(me.lng).toBe(-74.0)
    expect(me.at).toBeDefined()
    expect(typeof me.ageSec).toBe('number')
    expect(me.ageSec).toBeGreaterThanOrEqual(0)
    expect(me.activeDelivery).toBeDefined()
    expect(me.activeDelivery.id).toBe(deliveryId)

    // cleanup: free the driver for the next tests
    await call(`/api/deliveries/${deliveryId}/unassign`, { method: 'POST', headers: admin })
  })

  it('courier tracking link is stored (existing notes column) and surfaced on get/list', async () => {
    const deliveryId = await makeDelivery()
    const url = 'https://courier.example.test/track/ABC123'
    const set = await call(`/api/deliveries/${deliveryId}/tracking`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ trackingUrl: url })
    })
    expect(set.status).toBe(200)
    expect(set.body.data.trackingUrl).toBe(url)

    const get = await call(`/api/deliveries/${deliveryId}`, { headers: admin })
    expect(get.body.data.trackingUrl).toBe(url)

    const bad = await call(`/api/deliveries/${deliveryId}/tracking`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ trackingUrl: 'not-a-url' })
    })
    expect(bad.status).toBe(400)
  })

  it('POD requires an arrived delivery and at least one field, then completes it', async () => {
    const deliveryId = await makeDelivery()
    await assignToDriver(deliveryId)

    const early = await call(`/api/deliveries/${deliveryId}/pod`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ note: 'too early' })
    })
    expect(early.status).toBe(409)

    await driveTo(deliveryId, ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED'])

    const empty = await call(`/api/deliveries/${deliveryId}/pod`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({})
    })
    expect(empty.status).toBe(400)

    const pod = await call(`/api/deliveries/${deliveryId}/pod`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ note: 'Left at door', photoUrl: 'https://cdn.example.test/pod/1.jpg', signature: 'J. Doe' })
    })
    expect(pod.status).toBe(200)
    expect(pod.body.data.status).toBe('DELIVERED')
    expect(pod.body.data.pod).toMatchObject({ note: 'Left at door', photoUrl: 'https://cdn.example.test/pod/1.jpg', signature: 'J. Doe' })

    const driversList = await call('/api/drivers', { headers: admin })
    const d = driversList.body.data.items.find((x: { id: string }) => x.id === driverId)
    expect(d.status).toBe('ONLINE')
  })

  it('failed deliveries require a reason code (note required for other)', async () => {
    const deliveryId = await makeDelivery()
    await assignToDriver(deliveryId)
    await driveTo(deliveryId, ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT'])

    const invalid = await call(`/api/deliveries/${deliveryId}/fail`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ reason: 'nope', note: 'x' })
    })
    expect([400, 422]).toContain(invalid.status)

    const otherNoNote = await call(`/api/deliveries/${deliveryId}/fail`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ reason: 'other' })
    })
    expect(otherNoNote.status).toBe(400)

    const failed = await call(`/api/deliveries/${deliveryId}/fail`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ reason: 'no_answer', note: 'Nobody home after 3 knocks' })
    })
    expect(failed.status).toBe(200)
    expect(failed.body.data.status).toBe('FAILED')
    expect(failed.body.data.failReason).toBe('no_answer')
    expect(failed.body.data.failNote).toBe('Nobody home after 3 knocks')

    const driversList = await call('/api/drivers', { headers: admin })
    const d = driversList.body.data.items.find((x: { id: string }) => x.id === driverId)
    expect(d.status).toBe('ONLINE')
  })

  it('failing an unassigned delivery is rejected', async () => {
    const deliveryId = await makeDelivery()
    const res = await call(`/api/deliveries/${deliveryId}/fail`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ reason: 'refused', note: 'refused' })
    })
    expect(res.status).toBe(409)
  })
})

afterAll(async () => {
  const [u] = await db.select().from(users).where(eq(users.email, driverEmail)).limit(1)
  if (u) {
    await db.delete(drivers).where(eq(drivers.userId, u.id))
    await db.delete(users).where(eq(users.id, u.id))
  }
})
