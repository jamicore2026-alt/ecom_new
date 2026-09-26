import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { hash } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  deliveryOrders,
  deliveryZones,
  drivers,
  orders,
  outlets as outletsTable,
  paymentTransactions,
  registerShifts,
  userOutlets,
  users
} from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => null)
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

let admin: Record<string, string> = {}
let mainOutletId = ''
let menuItemId = ''
const stamp = Date.now().toString(36)

const cleanup = {
  shifts: [] as string[],
  orders: [] as string[],
  deliveries: [] as string[],
  zones: [] as string[],
  users: [] as string[],
  outlets: [] as string[]
}

async function makeFoodOrder(headers: Record<string, string>, outletId: string, orderType = 'TAKEAWAY') {
  const res = await call('/api/food-orders', {
    method: 'POST',
    headers: { ...headers, ...jh },
    body: JSON.stringify({ orderType, outletId, items: [{ menuItemId, quantity: 1 }] })
  })
  expect(res.status).toBe(200)
  cleanup.orders.push(res.body.data.id)
  return res.body.data as { id: string; total: number }
}

describe('register shifts: cash-drawer lifecycle', () => {
  let shiftId = ''
  let orderTotal = 0

  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    const outs = await call('/api/outlets', { headers: admin })
    mainOutletId = outs.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    for (const mod of ['restaurant', 'delivery']) {
      const res = await call(`/api/modules/${mod}`, {
        method: 'PUT',
        headers: { ...admin, ...jh },
        body: JSON.stringify({ enabled: true })
      })
      expect(res.status).toBe(200)
    }

    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find(
      (i: { available: boolean; status: string }) => i.available && i.status === 'active'
    ).id
  }, 20000)

  it('opens a shift with an opening bank', async () => {
    const res = await call('/api/register-shifts/open', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletId: mainOutletId, openBank: 100 })
    })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('open')
    expect(Number(res.body.data.openBank)).toBe(100)
    shiftId = res.body.data.id
    cleanup.shifts.push(shiftId)
  })

  it('rejects a second open shift for the same outlet → 409', async () => {
    const res = await call('/api/register-shifts/open', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletId: mainOutletId, openBank: 50 })
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SHIFT_ALREADY_OPEN')
  })

  it('rejects a negative opening bank', async () => {
    const branch = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: `Shift Neg ${stamp}`, code: `SN${stamp}`, status: 'active' })
    })
    expect(branch.status).toBe(200)
    cleanup.outlets.push(branch.body.data.id)
    const res = await call('/api/register-shifts/open', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletId: branch.body.data.id, openBank: -5 })
    })
    expect([400, 422]).toContain(res.status)
  })

  it('records a drop and a payout; rejects non-positive amounts', async () => {
    const bad = await call(`/api/register-shifts/${shiftId}/drop`, {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ amount: 0 })
    })
    expect([400, 422]).toContain(bad.status)

    const drop = await call(`/api/register-shifts/${shiftId}/drop`, {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ amount: 20, reason: 'mid-day safe drop' })
    })
    expect(drop.status).toBe(200)
    expect(drop.body.data.drops).toHaveLength(1)
    expect(Number(drop.body.data.drops[0].amount)).toBe(20)

    const payout = await call(`/api/register-shifts/${shiftId}/payout`, {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ amount: 10, reason: 'supplier COD' })
    })
    expect(payout.status).toBe(200)
    expect(payout.body.data.payouts).toHaveLength(1)
  })

  it('exposes the open shift via /current', async () => {
    const res = await call(`/api/register-shifts/current?outletId=${mainOutletId}`, { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data?.id).toBe(shiftId)
  })

  it('closes with a Z-report: expected = bank + cash sales + drops − payouts', async () => {
    // A cash sale inside the shift window (payment_transactions written directly;
    // the food-orders pay endpoint is out of scope for this change).
    const order = await makeFoodOrder(admin, mainOutletId)
    orderTotal = Number(order.total)
    await db.insert(paymentTransactions).values({
      merchantId: (await db.select().from(users).where(eq(users.email, 'admin@jamicore.com')).limit(1))[0].merchantId,
      orderId: order.id,
      provider: 'cash',
      status: 'paid',
      amount: orderTotal,
      currency: 'USD'
    })

    const expected = 100 + orderTotal + 20 - 10
    const actual = Number((expected + 5).toFixed(2))
    const res = await call(`/api/register-shifts/${shiftId}/close`, {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ actualCash: actual })
    })
    expect(res.status).toBe(200)
    const z = res.body.data.zReport
    expect(res.body.data.shift.status).toBe('closed')
    expect(z.cashSales).toBeCloseTo(orderTotal, 2)
    expect(z.dropsTotal).toBeCloseTo(20, 2)
    expect(z.payoutsTotal).toBeCloseTo(10, 2)
    expect(z.expectedCash).toBeCloseTo(expected, 2)
    expect(z.actualCash).toBeCloseTo(actual, 2)
    expect(z.variance).toBeCloseTo(5, 2)
  })

  it('rejects writes on a closed shift → 409', async () => {
    const drop = await call(`/api/register-shifts/${shiftId}/drop`, {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ amount: 5 })
    })
    expect(drop.status).toBe(409)
    expect(drop.body.error.code).toBe('SHIFT_CLOSED')

    const close = await call(`/api/register-shifts/${shiftId}/close`, {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ actualCash: 1 })
    })
    expect(close.status).toBe(409)
  })

  it('lists shifts and rejects an unknown status filter', async () => {
    const bad = await call('/api/register-shifts?status=bogus', { headers: admin })
    expect(bad.status).toBe(400)

    const list = await call(`/api/register-shifts?outletId=${mainOutletId}&status=closed`, { headers: admin })
    expect(list.status).toBe(200)
    expect(list.body.data.items.map((s: { id: string }) => s.id)).toContain(shiftId)
  })

  it('scopes shifts to the caller outlets (default-deny)', async () => {
    const branch = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: `Shift Branch ${stamp}`, code: `SB${stamp}`, status: 'active' })
    })
    expect(branch.status).toBe(200)
    const branchId = branch.body.data.id
    cleanup.outlets.push(branchId)

    const email = `shift-scope-${stamp}@jamicore.com`
    const staff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Shift Scope',
        email,
        password: 'Scope-pass-123456',
        role: 'staff',
        permissions: ['orders.read', 'orders.create', 'payments.read', 'payments.create']
      })
    })
    expect(staff.status).toBe(200)
    cleanup.users.push(staff.body.data.id)
    await call(`/api/user-outlets/${staff.body.data.id}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletIds: [branchId] })
    })
    const scoped = await loginAs(email, 'Scope-pass-123456')

    const denied = await call('/api/register-shifts/open', {
      method: 'POST',
      headers: { ...scoped, ...jh },
      body: JSON.stringify({ outletId: mainOutletId, openBank: 10 })
    })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('OUTLET_SCOPE')

    const allowed = await call('/api/register-shifts/open', {
      method: 'POST',
      headers: { ...scoped, ...jh },
      body: JSON.stringify({ outletId: branchId, openBank: 10 })
    })
    expect(allowed.status).toBe(200)
    cleanup.shifts.push(allowed.body.data.id)

    const deniedGet = await call(`/api/register-shifts/${shiftId}`, { headers: scoped })
    expect(deniedGet.status).toBe(403)

    await db.delete(users).where(eq(users.id, staff.body.data.id)).catch(() => null)
    await db.delete(userOutlets).where(eq(userOutlets.userId, staff.body.data.id)).catch(() => null)
    cleanup.users = cleanup.users.filter((id) => id !== staff.body.data.id)
  })

  afterAll(async () => {
    for (const id of cleanup.shifts) await db.delete(registerShifts).where(eq(registerShifts.id, id)).catch(() => null)
    for (const id of cleanup.deliveries) await db.delete(deliveryOrders).where(eq(deliveryOrders.id, id)).catch(() => null)
    for (const id of cleanup.orders) await db.delete(orders).where(eq(orders.id, id)).catch(() => null)
    for (const id of cleanup.zones) await db.delete(deliveryZones).where(eq(deliveryZones.id, id)).catch(() => null)
    for (const id of cleanup.users) {
      await db.delete(userOutlets).where(eq(userOutlets.userId, id)).catch(() => null)
      await db.delete(users).where(eq(users.id, id)).catch(() => null)
    }
    for (const id of cleanup.outlets) await db.delete(outletsTable).where(eq(outletsTable.id, id)).catch(() => null)
  })
})

describe('delivery zone rules + driver outlet scope', () => {
  let zoneId = ''
  let freeZoneId = ''
  let radiusZoneId = ''

  beforeAll(async () => {
    if (!admin.authorization) admin = await loginAs('admin@jamicore.com')
    const outs = await call('/api/outlets', { headers: admin })
    mainOutletId = outs.body.data.find((o: { code: string }) => o.code === 'MAIN').id
    const menu = await call('/api/menu', { headers: admin })
    menuItemId =
      menuItemId ||
      menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id
  }, 20000)

  it('rejects delivery creation below the zone minOrder', async () => {
    const zone = await call('/api/delivery-zones', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: `MinOrder ${stamp}`,
        outletId: mainOutletId,
        centerLat: 40.7128,
        centerLng: -74.006,
        radiusKm: 50,
        deliveryFee: 5,
        minOrder: 1000000
      })
    })
    expect(zone.status).toBe(200)
    zoneId = zone.body.data.id
    cleanup.zones.push(zoneId)

    const order = await makeFoodOrder(admin, mainOutletId, 'DELIVERY')
    const res = await call('/api/deliveries', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: order.id, zoneId })
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BELOW_MIN_ORDER')
  })

  it('applies freeDeliveryThreshold (fee = 0)', async () => {
    const zone = await call('/api/delivery-zones', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: `FreeDel ${stamp}`,
        outletId: mainOutletId,
        centerLat: 40.7128,
        centerLng: -74.006,
        radiusKm: 50,
        deliveryFee: 9,
        minOrder: 0,
        freeDeliveryThreshold: 0.01
      })
    })
    expect(zone.status).toBe(200)
    freeZoneId = zone.body.data.id
    cleanup.zones.push(freeZoneId)

    const order = await makeFoodOrder(admin, mainOutletId, 'DELIVERY')
    const res = await call('/api/deliveries', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: order.id, zoneId: freeZoneId })
    })
    expect(res.status).toBe(200)
    expect(Number(res.body.data.fee)).toBe(0)
    cleanup.deliveries.push(res.body.data.id)
  })

  it('rejects addresses outside the zone radius, accepts inside', async () => {
    const zone = await call('/api/delivery-zones', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: `Radius ${stamp}`,
        outletId: mainOutletId,
        centerLat: 40.7128,
        centerLng: -74.006,
        radiusKm: 1,
        deliveryFee: 3
      })
    })
    expect(zone.status).toBe(200)
    radiusZoneId = zone.body.data.id
    cleanup.zones.push(radiusZoneId)

    // Far address (stored on the order — the create body strips unknown keys).
    const far = await makeFoodOrder(admin, mainOutletId, 'DELIVERY')
    await db.update(orders).set({ shippingAddress: { lat: 41.5, lng: -75 } as never }).where(eq(orders.id, far.id))
    const denied = await call('/api/deliveries', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: far.id, zoneId: radiusZoneId })
    })
    expect(denied.status).toBe(400)
    expect(denied.body.error.code).toBe('OUT_OF_DELIVERY_ZONE')

    const near = await makeFoodOrder(admin, mainOutletId, 'DELIVERY')
    await db.update(orders).set({ shippingAddress: { lat: 40.713, lng: -74.006 } as never }).where(eq(orders.id, near.id))
    const allowed = await call('/api/deliveries', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: near.id, zoneId: radiusZoneId })
    })
    expect(allowed.status).toBe(200)
    expect(Number(allowed.body.data.fee)).toBe(3)
    cleanup.deliveries.push(allowed.body.data.id)
  })

  it('scopes the driver list to outlet assignments and searches with ilike', async () => {
    const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com')).limit(1)
    const [user] = await db
      .insert(users)
      .values({
        merchantId: adminUser.merchantId,
        name: `Scope Searchable ${stamp}`,
        email: `shift-driver-${stamp}@jamicore.com`,
        passwordHash: await hash('password123', 10),
        role: 'driver',
        permissions: [],
        status: 'active'
      })
      .returning()
    cleanup.users.push(user.id)

    const created = await call('/api/drivers', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ userId: user.id, name: `Scope Searchable ${stamp}`, assignedOutletId: mainOutletId })
    })
    expect(created.status).toBe(200)
    const driverId = created.body.data.id

    // Partial, case-insensitive search matches.
    const search = await call(`/api/drivers?search=${stamp.slice(0, 4)}`, { headers: admin })
    expect(search.status).toBe(200)
    expect(search.body.data.items.map((d: { id: string }) => d.id)).toContain(driverId)

    // Outlet filter: MAIN driver is invisible under another outlet.
    const branch = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: `Driver Branch ${stamp}`, code: `DB${stamp}`, status: 'active' })
    })
    expect(branch.status).toBe(200)
    cleanup.outlets.push(branch.body.data.id)
    const filtered = await call(`/api/drivers?outletId=${branch.body.data.id}`, { headers: admin })
    expect(filtered.status).toBe(200)
    expect(filtered.body.data.items.map((d: { id: string }) => d.id)).not.toContain(driverId)

    await db.delete(drivers).where(eq(drivers.id, driverId)).catch(() => null)
  })
})
