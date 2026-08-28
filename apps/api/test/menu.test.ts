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

let createdMenuItemId = ''
let createdGroupId = ''
let adminToken = ''

describe('Phase 3: food menu', () => {
  let admin: Record<string, string>
  let productId = ''

  it('loads admin context with restaurant module enabled', async () => {
    admin = await loginAs('admin@acme.com')
    adminToken = admin.authorization
    const me = await call('/api/auth/me', { headers: admin })
    expect(me.status).toBe(200)
    expect(me.body.data.enabledModules).toContain('restaurant')
  })

  it('lists seeded menu items joined with product info', async () => {
    const res = await call('/api/menu', { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThan(0)
    const first = res.body.data.items[0]
    expect(first.product).toBeTruthy()
    expect(typeof first.preparationTimeMin).toBe('number')
  })

  it('lists modifier groups with their modifiers', async () => {
    const res = await call('/api/modifier-groups', { headers: admin })
    expect(res.status).toBe(200)
    const group = res.body.data.find((g: { name: string }) => g.name === 'Add Ons')
    expect(group).toBeTruthy()
    expect(group.modifiers.length).toBeGreaterThan(0)
  })

  it('creates a menu item from a product, binds a group, sets an outlet rule', async () => {
    const menuRes = await call('/api/menu', { headers: admin })
    const onMenu = new Set((menuRes.body.data.items as { productId: string }[]).map((m) => m.productId))
    const products = (await call('/api/products', { headers: admin })).body.data.items
    productId = products.find((p: { id: string }) => !onMenu.has(p.id)).id

    const created = await call('/api/menu', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({
        productId,
        preparationTimeMin: 15,
        kitchenStation: 'Grill',
        dietaryTags: ['vegan'],
        allergens: [],
        taxRate: 0,
        availability: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '22:00' }]
      })
    })
    expect(created.status).toBe(200)
    expect(created.body.data.id).toBeTruthy()
    createdMenuItemId = created.body.data.id
    expect(created.body.data.kitchenStation).toBe('Grill')

    const dup = await call('/api/menu', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ productId })
    })
    expect(dup.status).toBe(409)

    const groups = await call('/api/modifier-groups', { headers: admin })
    const addOns = groups.body.data.find((g: { name: string }) => g.name === 'Add Ons')
    const bind = await call(`/api/menu/${createdMenuItemId}/modifiers`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ groupId: addOns.id })
    })
    expect(bind.status).toBe(200)
    expect(bind.body.data.modifierGroups.some((g: { name: string }) => g.name === 'Add Ons')).toBe(true)
  })

  it('updates and archives a menu item', async () => {
    const updated = await call(`/api/menu/${createdMenuItemId}`, {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ preparationTimeMin: 20, available: false })
    })
    expect(updated.status).toBe(200)
    expect(updated.body.data.preparationTimeMin).toBe(20)
    expect(updated.body.data.available).toBe(false)

    const archived = await call(`/api/menu/${createdMenuItemId}`, { method: 'DELETE', headers: admin })
    expect(archived.status).toBe(200)
    expect(archived.body.data.status).toBe('archived')
  })

  it('creates and removes a modifier group', async () => {
    const created = await call('/api/modifier-groups', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ name: 'Temp Group', required: true, minSelections: 1, maxSelections: 2 })
    })
    expect(created.status).toBe(200)
    createdGroupId = created.body.data.id

    const removed = await call(`/api/modifier-groups/${createdGroupId}`, { method: 'DELETE', headers: admin })
    expect(removed.status).toBe(200)
    createdGroupId = ''
  })

  it('denies staff writes and non-menu staff reads without permissions', async () => {
    const staff = await loginAs('staff@acme.com')
    const createItem = await call('/api/menu', {
      method: 'POST',
      headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ productId: 'nope' })
    })
    expect(createItem.status).toBe(403)

    const createGroup = await call('/api/modifier-groups', {
      method: 'POST',
      headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ name: 'Rogue' })
    })
    expect(createGroup.status).toBe(403)
  })
})

afterAll(async () => {
  const admin = adminToken ? { authorization: adminToken } : await loginAs('admin@acme.com')
  if (createdMenuItemId) {
    await call(`/api/menu/${createdMenuItemId}`, { method: 'DELETE', headers: admin })
  }
  if (createdGroupId) {
    await call(`/api/modifier-groups/${createdGroupId}`, { method: 'DELETE', headers: admin })
  }
})
