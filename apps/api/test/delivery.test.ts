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
let staff: Record<string, string> = {}
let resOutletId = ''
const stamp = Date.now().toString(36)
let menuItemId = ''

let driver1Auth: Record<string, string> = {}
let driver2UserId = ''
let driver1Id = ''
let driver2Id = ''

async function makeDeliveryOrder() {
  const order = await call('/api/food-orders', {
    method: 'POST',
    headers: { ...admin, ...jsonHeaders },
    body: JSON.stringify({ orderType: 'DELIVERY', outletId: resOutletId, items: [{ menuItemId, quantity: 1 }] })
  })
  expect(order.status).toBe(200)
  return order.body.data.id
}

async function createDriver(driverEmail: string) {
  const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@acme.com')).limit(1)
  const [user] = await db
    .insert(users)
    .values({
      merchantId: adminUser.merchantId,
      name: 'Test Driver',
      email: driverEmail,
      passwordHash: await hash('password123', 10),
      role: 'driver',
      permissions: ['delivery.read', 'drivers.read'],
      status: 'active'
    })
    .returning()
  return user
}

async function makeDriverRecord(userId: string, name: string, status: 'ONLINE' | 'OFFLINE' = 'ONLINE') {
  const res = await call('/api/drivers', {
    method: 'POST',
    headers: { ...admin, ...jsonHeaders },
    body: JSON.stringify({ userId, name, vehicleType: 'motorcycle', vehiclePlate: `${stamp}`, assignedOutletId: resOutletId })
  })
  expect(res.status).toBe(200)
  if (status !== 'OFFLINE') {
    await call(`/api/drivers/${res.body.data.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status })
    })
  }
  return res.body.data.id
}

describe('Phase 7: delivery + drivers', () => {
  beforeAll(async () => {
    admin = await loginAs('admin@acme.com')
    staff = await loginAs('staff@acme.com')
    const outlets = await call('/api/outlets', { headers: admin })
    resOutletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    const mod = await call('/api/modules/delivery', {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ enabled: true })
    })
    expect(mod.status).toBe(200)

    const menu = await call('/api/menu', { headers: admin })
    const item = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active')
    menuItemId = item.id

    // dedicated drivers
    const d1 = await createDriver(`driver1-${stamp}@test.test`)
    driver1Id = await makeDriverRecord(d1.id, 'Driver One', 'ONLINE')
    driver1Auth = await loginAs(`driver1-${stamp}@test.test`)
    const d2 = await createDriver(`driver2-${stamp}@test.test`)
    driver2UserId = d2.id
    driver2Id = await makeDriverRecord(d2.id, 'Driver Two', 'OFFLINE')
  }, 20000)

  it('creates and lists a delivery zone, duplicate name → 409', async () => {
    const zoneName = `Zone ${stamp}`
    const created = await call('/api/delivery-zones', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ name: zoneName, outletId: resOutletId, centerLat: 40.7128, centerLng: -74.006, radiusKm: 8, deliveryFee: 4, etaMin: 25 })
    })
    expect(created.status).toBe(200)
    expect(created.body.data.name).toBe(zoneName)
    expect(created.body.data.radiusKm).toBe(8)

    const dup = await call('/api/delivery-zones', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ name: zoneName, centerLat: 0, centerLng: 0 })
    })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('ZONE_EXISTS')

    const list = await call('/api/delivery-zones', { headers: admin })
    expect(list.status).toBe(200)
    expect(list.body.data.some((z: { name: string }) => z.name === zoneName)).toBe(true)
  })

  it('creates a delivery from a DELIVERY order in UNASSIGNED state', async () => {
    const orderId = await makeDeliveryOrder()
    const created = await call('/api/deliveries', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderId })
    })
    expect(created.status).toBe(200)
    expect(created.body.data.status).toBe('UNASSIGNED')

    const dup = await call('/api/deliveries', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ orderId })
    })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('DELIVERY_EXISTS')
  })

  it('assigns an online driver, marks them BUSY, and unassigns back to UNASSIGNED', async () => {
    const orderId = await makeDeliveryOrder()
    const created = await call('/api/deliveries', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ orderId })
    })
    const deliveryId = created.body.data.id

    const assigned = await call(`/api/deliveries/${deliveryId}/assign`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ driverId: driver1Id })
    })
    expect(assigned.status).toBe(200)
    expect(assigned.body.data.status).toBe('ASSIGNED')
    expect(assigned.body.data.assignedDriverId).toBe(driver1Id)

    // driver list shows BUSY
    const drivers = await call('/api/drivers', { headers: admin })
    const d1 = drivers.body.data.items.find((d: { id: string }) => d.id === driver1Id)
    expect(d1.status).toBe('BUSY')

    // unassign → UNASSIGNED and driver back ONLINE
    const unassigned = await call(`/api/deliveries/${deliveryId}/unassign`, { method: 'POST', headers: admin })
    expect(unassigned.status).toBe(200)
    expect(unassigned.body.data.status).toBe('UNASSIGNED')
    const drivers2 = await call('/api/drivers', { headers: admin })
    const d1b = drivers2.body.data.items.find((d: { id: string }) => d.id === driver1Id)
    expect(d1b.status).toBe('ONLINE')
  })

  it('runs the validated delivery lifecycle to DELIVERED and frees the driver', async () => {
    const orderId = await makeDeliveryOrder()
    const created = await call('/api/deliveries', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ orderId })
    })
    const deliveryId = created.body.data.id
    await call(`/api/deliveries/${deliveryId}/assign`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ driverId: driver1Id })
    })

    const steps = ['ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED']
    for (const s of steps) {
      const res = await call(`/api/deliveries/${deliveryId}/status`, {
        method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: s })
      })
      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe(s)
    }

    // driver freed after delivery
    const drivers = await call('/api/drivers', { headers: admin })
    const d1 = drivers.body.data.items.find((d: { id: string }) => d.id === driver1Id)
    expect(d1.status).toBe('ONLINE')

    const bad = await call(`/api/deliveries/${deliveryId}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ASSIGNED' })
    })
    expect(bad.status).toBe(409)
  })

  it('dispatch fails when no eligible driver is available', async () => {
    // take every driver offline so no eligible driver is available
    const list = await call('/api/drivers', { headers: admin })
    for (const d of list.body.data.items) {
      if (d.status !== 'OFFLINE') {
        await call('/api/drivers/' + d.id + '/status', {
          method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'OFFLINE' })
        })
      }
    }
    const orderId = await makeDeliveryOrder()
    const created = await call('/api/deliveries', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ orderId })
    })
    const deliveryId = created.body.data.id
    const dispatch = await call(`/api/deliveries/${deliveryId}/dispatch`, { method: 'POST', headers: admin })
    expect(dispatch.status).toBe(409)
    expect(dispatch.body.error.code).toBe('NO_DRIVERS_AVAILABLE')
    // restore driver1 so later tests can dispatch again
    await call('/api/drivers/' + driver1Id + '/status', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ONLINE' })
    })
  })

  it('auto-dispatch picks an eligible online + correct-outlet driver', async () => {
    const orderId = await makeDeliveryOrder()
    const created = await call('/api/deliveries', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ orderId })
    })
    const deliveryId = created.body.data.id
    const dispatch = await call(`/api/deliveries/${deliveryId}/dispatch`, { method: 'POST', headers: admin })
    expect(dispatch.status).toBe(200)
    expect(dispatch.body.data.status).toBe('ASSIGNED')
    expect(dispatch.body.data.assignedDriverId).toBe(driver1Id)
  })

  it('driver self-service: profile, status transition, location, and scoped orders', async () => {
    const me = await call('/api/delivery/me', { headers: driver1Auth })
    expect(me.status).toBe(200)
    expect(me.body.data.id).toBe(driver1Id)

    const loc = await call('/api/delivery/me/location', {
      method: 'POST', headers: { ...driver1Auth, ...jsonHeaders }, body: JSON.stringify({ lat: 40.7, lng: -74.01 })
    })
    expect(loc.status).toBe(200)
    expect(loc.body.data.lat).toBe(40.7)

    // OFFLINE → ONLINE valid
    await call('/api/drivers/' + driver1Id + '/status', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ONLINE' })
    })
    const orders = await call('/api/delivery/me/orders', { headers: driver1Auth })
    expect(orders.status).toBe(200)
    expect(Array.isArray(orders.body.data.items)).toBe(true)
  })

  it('denies delivery writes to staff lacking delivery permissions', async () => {
    const zone403 = await call('/api/delivery-zones', {
      method: 'POST', headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ name: `Nope ${stamp}`, centerLat: 0, centerLng: 0 })
    })
    expect(zone403.status).toBe(403)

    const orderId = await makeDeliveryOrder()
    const del403 = await call('/api/deliveries', {
      method: 'POST', headers: { ...staff, ...jsonHeaders }, body: JSON.stringify({ orderId })
    })
    expect(del403.status).toBe(403)
  })

  it('driver status invalid transition → 409', async () => {
    // driver2 is OFFLINE; OFFLINE → PAUSED is not a valid jump
    const bad = await call('/api/drivers/' + driver2Id + '/status', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'PAUSED' })
    })
    expect(bad.status).toBe(409)
    expect(bad.body.error.code).toBe('INVALID_TRANSITION')
  })
})

afterAll(async () => {
  for (const email of [`driver1-${stamp}@test.test`, `driver2-${stamp}@test.test`]) {
    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (u) {
      await db.delete(drivers).where(eq(drivers.userId, u.id))
      await db.delete(users).where(eq(users.id, u.id))
    }
  }
})
