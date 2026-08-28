import { describe, expect, it, afterAll } from 'bun:test'
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

let adminToken = ''
let createdIds: string[] = []

describe('Phase 4: unified food orders', () => {
  let admin: Record<string, string>
  let outletId = ''
  let menuItem: { id: string; product: { price: number } }
  let addOnModifier: { id: string; priceAdjustment: number }

  it('loads admin + outlet + a menu item with a modifier', async () => {
    admin = await loginAs('admin@acme.com')
    adminToken = admin.authorization

    const outlets = await call('/api/outlets', { headers: admin })
    outletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    const menu = await call('/api/menu', { headers: admin })
    menuItem = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active')

    const groups = await call('/api/modifier-groups', { headers: admin })
    const addOns = groups.body.data.find((g: { name: string }) => g.name === 'Add Ons')
    addOnModifier = addOns.modifiers[0]
  })

  it('creates a DINE_IN food order with a modifier and computes totals', async () => {
    const res = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({
        orderType: 'DINE_IN',
        outletId,
        notes: 'Table spot',
        items: [
          { menuItemId: menuItem.id, quantity: 2, modifiers: [{ modifierId: addOnModifier.id, quantity: 1 }] }
        ]
      })
    })
    expect(res.status).toBe(200)
    const order = res.body.data
    expect(order.orderType).toBe('DINE_IN')
    expect(order.status).toBe('CREATED')
    expect(order.outletId).toBe(outletId)
    expect(order.orderNumber.startsWith('#F')).toBe(true)
    expect(order.items).toHaveLength(1)

    const expectedUnit = Math.round((Number(menuItem.product.price) + addOnModifier.priceAdjustment) * 100) / 100
    expect(order.items[0].unitPrice).toBe(expectedUnit)
    expect(order.items[0].total).toBe(Math.round(expectedUnit * 2 * 100) / 100)
    expect(order.subtotal).toBe(order.items[0].total)
    expect(order.total).toBe(order.subtotal)
    expect(order.items[0].modifiers[0].name).toBeTruthy()
    createdIds.push(order.id)
  })

  it('walks the validated state machine forward', async () => {
    const res = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'TAKEAWAY', outletId, items: [{ menuItemId: menuItem.id, quantity: 1 }] })
    })
    expect(res.status).toBe(200)
    const id = res.body.data.id
    createdIds.push(id)

    for (const next of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      const step = await call(`/api/food-orders/${id}/status`, {
        method: 'POST',
        headers: { ...admin, ...jsonHeaders },
        body: JSON.stringify({ status: next })
      })
      expect(step.status).toBe(200)
      expect(step.body.data.status).toBe(next)
    }

    const tooLate = await call(`/api/food-orders/${id}/status`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ status: 'CANCELLED' })
    })
    expect(tooLate.status).toBe(409)
  })

  it('rejects invalid state jumps and unknown statuses', async () => {
    const res = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DINE_IN', outletId, items: [{ menuItemId: menuItem.id, quantity: 1 }] })
    })
    const id = res.body.data.id
    createdIds.push(id)

    const jump = await call(`/api/food-orders/${id}/status`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ status: 'READY' })
    })
    expect(jump.status).toBe(409)

    const bogus = await call(`/api/food-orders/${id}/status`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ status: 'shipped' })
    })
    expect(bogus.status).toBe(400)
  })

  it('cancels a CREATED order via the cancel endpoint', async () => {
    const res = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DELIVERY', outletId, items: [{ menuItemId: menuItem.id, quantity: 1 }] })
    })
    const id = res.body.data.id
    createdIds.push(id)

    const cancelled = await call(`/api/food-orders/${id}/cancel`, { method: 'POST', headers: admin })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.status).toBe('CANCELLED')
  })

  it('rejects a modifier the item does not offer', async () => {
    const res = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({
        orderType: 'DINE_IN',
        outletId,
        items: [{ menuItemId: menuItem.id, quantity: 1, modifiers: [{ modifierId: 'nonexistent123' }] }]
      })
    })
    expect(res.status).toBe(404)
  })

  it('lists and filters food orders, excluding ecommerce orders', async () => {
    const res = await call('/api/food-orders', { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThan(0)
    expect(res.body.data.items.every((o: { orderType: string }) => o.orderType !== 'ecommerce')).toBe(true)

    const filtered = await call(`/api/food-orders?orderType=DINE_IN`, { headers: admin })
    expect(filtered.body.data.items.every((o: { orderType: string }) => o.orderType === 'DINE_IN')).toBe(true)
  })

  it('denies non-restaurant staff writes', async () => {
    const staff = await loginAs('staff@acme.com')
    const res = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DINE_IN', outletId, items: [{ menuItemId: menuItem.id, quantity: 1 }] })
    })
    expect(res.status).toBe(403)
  })
})

afterAll(async () => {
  if (!adminToken) return
  const admin = { authorization: adminToken }
  // Food orders supersede items via cascade; nothing else to clean up.
})
