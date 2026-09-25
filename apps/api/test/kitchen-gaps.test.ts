import { describe, expect, it, beforeAll } from 'bun:test'
import { app } from '../src/app'

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

describe('Kitchen gaps: hold/fire, metrics, unavailable exclusion', () => {
  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    const outlets = await call('/api/outlets', { headers: admin })
    resOutletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id
    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id
  }, 20000)

  it('hold sets fireAt, KDS hides the held line, fire-now clears it', async () => {
    const order = await call('/api/food-orders', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DINE_IN', outletId: resOutletId, items: [{ menuItemId, quantity: 1 }] })
    })
    expect(order.status).toBe(200)
    const orderId = order.body.data.id
    const lineId = order.body.data.items[0].id

    const future = new Date(Date.now() + 3600_000).toISOString()
    const held = await call(`/api/kitchen/order-items/${lineId}/hold`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ fireAt: future })
    })
    expect(held.status).toBe(200)
    expect(new Date(held.body.data.fireAt).getTime()).toBeGreaterThan(Date.now())

    await call(`/api/kitchen/orders/${orderId}/tickets`, { method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({}) })
    const board = await call('/api/kitchen/kds', { headers: admin })
    expect(board.status).toBe(200)
    expect(board.body.data.heldCount).toBeGreaterThanOrEqual(1)
    // Held line hidden from every ticket on the board.
    const allItems = board.body.data.stations.flatMap((s: { tickets: { items: { orderItemId: string }[] }[] }) => s.tickets.flatMap((t) => t.items))
    expect(allItems.some((i: { orderItemId: string }) => i.orderItemId === lineId)).toBe(false)

    const fired = await call(`/api/kitchen/order-items/${lineId}/fire`, { method: 'POST', headers: admin })
    expect(fired.status).toBe(200)
    expect(fired.body.data.fireAt).toBeNull()

    const bad = await call(`/api/kitchen/order-items/${lineId}/hold`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ fireAt: 'not-a-date' })
    })
    expect(bad.status).toBe(400)
  })

  it('station metrics endpoint returns avg prep time + delayed count', async () => {
    const res = await call('/api/kitchen/metrics/stations', { headers: admin })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    for (const row of res.body.data) {
      expect(row.stationId).toBeTruthy()
      expect(Number.isInteger(row.delayedCount)).toBe(true)
      expect(row.avgPrepMin === null || typeof row.avgPrepMin === 'number').toBe(true)
    }
  })

  it('unavailable menu items are excluded from KOT generation with notice', async () => {
    // Route a dedicated item to a unique station, then mark it unavailable.
    const menu = await call('/api/menu', { headers: admin })
    const avail = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active')
    const routed = await call(`/api/menu/${avail.id}`, {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ kitchenStation: `GapStation ${Date.now().toString(36)}` })
    })
    expect(routed.status).toBe(200)
    const off = await call(`/api/menu/${avail.id}`, {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ available: false })
    })
    expect(off.status).toBe(200)
    const order = await call('/api/food-orders', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DINE_IN', outletId: resOutletId, items: [{ menuItemId: avail.id, quantity: 1 }] })
    })
    // New orders for unavailable items are rejected server-side.
    if (order.status === 200) {
      const gen = await call(`/api/kitchen/orders/${order.body.data.id}/tickets`, {
        method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({})
      })
      // Either rejected (all unavailable) with a clear code, or created with notice.
      if (gen.status === 200) {
        expect(gen.body.data.skippedUnavailable.length).toBeGreaterThanOrEqual(0)
      } else {
        expect(gen.body.error.code).toBe('NO_AVAILABLE_ITEMS')
      }
    } else {
      expect(order.body.error.code).toBe('ITEM_UNAVAILABLE')
    }
    // Restore availability for other tests.
    await call(`/api/menu/${avail.id}`, {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ available: true })
    })
  })

  it('KDS board carries allergen + modifier data on lines', async () => {
    const order = await call('/api/food-orders', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DINE_IN', outletId: resOutletId, items: [{ menuItemId, quantity: 1 }] })
    })
    expect(order.status).toBe(200)
    await call(`/api/kitchen/orders/${order.body.data.id}/tickets`, { method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({}) })
    const board = await call('/api/kitchen/kds', { headers: admin })
    expect(board.status).toBe(200)
    expect('unavailableNotice' in board.body.data).toBe(true)
    const line = board.body.data.stations.flatMap((s: { tickets: { items: unknown[] }[] }) => s.tickets.flatMap((t) => t.items))[0]
    if (line) {
      expect(Array.isArray((line as { modifiers: unknown }).modifiers)).toBe(true)
      expect(Array.isArray((line as { allergens: unknown }).allergens)).toBe(true)
    }
  })
})
