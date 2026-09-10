import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { hash } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { deliveryOrders, deliveryZones, orders, outlets as outletsTable, userOutlets, users } from '../src/database/schema'

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

describe('restaurant-era outlet reads default-deny (delivery + menu)', () => {
  let admin: Record<string, string> = {}
  let scopeB: Record<string, string> = {}
  let adminUserId = ''
  let scopedUserId = ''
  let mainOutletId = ''
  let branchOutletId = ''
  let menuItemId = ''
  let mainDel: string | null = null
  const stamp = Date.now()
  const email = `dl-scope-${stamp}@jamicore.com`
  let mainZoneName = ''
  let branchZoneId = ''
  const cleanup = { zones: [] as string[], deliveries: [] as string[], orders: [] as string[], drivers: [] as string[] }

  const createFoodOrder = (headers: Record<string, string>, outletId: string, orderType = 'DELIVERY') =>
    call('/api/food-orders', {
      method: 'POST',
      headers: { ...headers, ...jh },
      body: JSON.stringify({ orderType, outletId, items: [{ menuItemId: menuItemId, quantity: 1 }] })
    })

  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    const [merchant] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com'))
    adminUserId = merchant.id

    const outs = await call('/api/outlets', { headers: admin })
    mainOutletId = outs.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    const branchRes = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: 'Branch DL', code: 'BRD', status: 'active' })
    })
    expect(branchRes.status).toBe(200)
    branchOutletId = branchRes.body.data.id

    const staff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'DL Scope',
        email,
        password: 'scope-pass-123456',
        role: 'staff',
        permissions: ['orders.read', 'orders.create', 'delivery.read', 'delivery.manage', 'delivery.assign', 'drivers.read', 'drivers.manage', 'menu.read', 'menu.manage']
      })
    })
    expect(staff.status).toBe(200)
    scopedUserId = staff.body.data.id
    const assigned = await call(`/api/user-outlets/${scopedUserId}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletIds: [branchOutletId] })
    })
    expect(assigned.status).toBe(200)
    scopeB = await loginAs(email, 'scope-pass-123456')

    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id

    // A branch-owned zone + a MAIN zone (seeded Downtown) as the out-of-scope control.
    const zone = await call('/api/delivery-zones', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: `BRD Zone ${stamp}`, outletId: branchOutletId, centerLat: 40.71, centerLng: -74.0, radiusKm: 5 })
    })
    expect(zone.status).toBe(200)
    branchZoneId = zone.body.data.id
    cleanup.zones.push(branchZoneId)

    const zones = await call('/api/delivery-zones', { headers: admin })
    mainZoneName = zones.body.data.find((z: { outletId: string }) => z.outletId === mainOutletId)?.name ?? ''
    expect(mainZoneName).toBeTruthy()

    // A MAIN delivery (admin) as the out-of-scope control.
    const mainOrder = await createFoodOrder(admin, mainOutletId)
    expect(mainOrder.status).toBe(200)
    cleanup.orders.push(mainOrder.body.data.id)
    const mainDelivery = await call('/api/deliveries', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: mainOrder.body.data.id, outletId: mainOutletId, zoneId: (await call('/api/delivery-zones', { headers: admin })).body.data.find((z: { name: string }) => z.name === mainZoneName)?.id })
    })
    expect(mainDelivery.status).toBe(200)
    mainDel = mainDelivery.body.data.id
    if (mainDel) cleanup.deliveries.push(mainDel)
  })

  it('filters delivery zones to the caller\'s outlets + shared zones', async () => {
    const zones = await call('/api/delivery-zones', { headers: scopeB })
    expect(zones.status).toBe(200)
    const zoneNames = zones.body.data.map((z: { name: string }) => z.name)
    expect(zoneNames).toContain(`BRD Zone ${stamp}`)
    expect(zoneNames).not.toContain(mainZoneName)
  })

  it('denies row-level zone reads/writes on out-of-scope zones', async () => {
    const zones = await call('/api/delivery-zones', { headers: admin })
    const mainZoneId = zones.body.data.find((z: { name: string }) => z.name === mainZoneName).id

    const deniedGet = await call(`/api/delivery-zones/${mainZoneId}`, { headers: scopeB })
    expect(deniedGet.status).toBe(403)
    expect(deniedGet.body.error.code).toBe('OUTLET_SCOPE')

    const deniedUpdate = await call(`/api/delivery-zones/${mainZoneId}`, {
      method: 'PUT',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'inactive' })
    })
    expect(deniedUpdate.status).toBe(403)
    expect(deniedUpdate.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('rejects creating a zone for an out-of-scope outlet', async () => {
    const res = await call('/api/delivery-zones', {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ name: `Leak ${stamp}`, outletId: mainOutletId, centerLat: 40.71, centerLng: -74.0 })
    })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('filters delivery orders and denies out-of-scope row ops', async () => {
    const branchOrder = await createFoodOrder(scopeB, branchOutletId)
    expect(branchOrder.status).toBe(200)
    cleanup.orders.push(branchOrder.body.data.id)
    const branchDelivery = await call('/api/deliveries', {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ orderId: branchOrder.body.data.id, outletId: branchOutletId, zoneId: branchZoneId })
    })
    expect(branchDelivery.status).toBe(200)
    const branchDeliveryId = branchDelivery.body.data.id
    cleanup.deliveries.push(branchDeliveryId)
    expect(branchDelivery.body.data.outletId).toBe(branchOutletId)

    const list = await call('/api/deliveries', { headers: scopeB })
    expect(list.status).toBe(200)
    const deliveryIds = list.body.data.items.map((d: { id: string }) => d.id)
    expect(deliveryIds).toContain(branchDeliveryId)
    expect(deliveryIds).not.toContain(mainDel)

    const deniedTransition = await call(`/api/deliveries/${mainDel}/status`, {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'PICKED_UP' })
    })
    expect(deniedTransition.status).toBe(403)
    expect(deniedTransition.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('keeps drivers as a merchant-wide shared pool but scopes writes', async () => {
    const driversRes = await call('/api/drivers', { headers: scopeB })
    expect(driversRes.status).toBe(200)
    expect(driversRes.body.data.items.length).toBeGreaterThan(0)

    const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com'))
    const [user] = await db
      .insert(users)
      .values({
        merchantId: adminUser.merchantId,
        name: 'Leak Driver',
        email: `dl-driver-${stamp}@jamicore.com`,
        passwordHash: await hash('password123', 10),
        role: 'driver',
        permissions: [],
        status: 'active'
      })
      .returning()
    cleanup.drivers.push(user.id)

    const denied = await call('/api/drivers', {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ userId: user.id, name: 'Leak Driver', assignedOutletId: mainOutletId })
    })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('keeps menu catalog merchant-wide but scopes outlet rules', async () => {
    const catalog = await call('/api/menu', { headers: scopeB })
    expect(catalog.status).toBe(200)
    expect(catalog.body.data.items.length).toBeGreaterThan(0)

    const denied = await call(`/api/menu/${menuItemId}/outlets`, {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ outletId: mainOutletId, available: true })
    })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('OUTLET_SCOPE')

    const allowed = await call(`/api/menu/${menuItemId}/outlets`, {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ outletId: branchOutletId, available: true })
    })
    expect(allowed.status).toBe(200)
  })

  afterAll(async () => {
    for (const id of cleanup.orders) await db.delete(orders).where(eq(orders.id, id)).catch(() => null)
    for (const id of cleanup.deliveries) await db.delete(deliveryOrders).where(eq(deliveryOrders.id, id)).catch(() => null)
    await db.delete(deliveryZones).where(eq(deliveryZones.id, branchZoneId)).catch(() => null)
    for (const id of cleanup.drivers) await db.delete(users).where(eq(users.id, id)).catch(() => null)
    await db.delete(outletsTable).where(eq(outletsTable.id, branchOutletId)).catch(() => null)
    await db.delete(users).where(eq(users.id, scopedUserId)).catch(() => null)
    await db.delete(userOutlets).where(eq(userOutlets.userId, scopedUserId)).catch(() => null)
    await db.delete(userOutlets).where(eq(userOutlets.userId, adminUserId)).catch(() => null)
  })
})