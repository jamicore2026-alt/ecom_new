import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { productVariants, products, users } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const text = await res.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body, res }
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

describe('roles authoritative via users.role_id (P2-3)', () => {
  let admin: Record<string, string> = {}
  let orderId = ''
  const createdEmails: string[] = []
  const stamp = Date.now()
  let seq = 0
  const specRole = { id: '' }

  const createSpecRole = async () => {
    const role = await call('/api/roles', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: `Spec-${stamp}`, permissions: ['orders.update'], scope: 'OUTLET' })
    })
    expect(role.status).toBe(200)
    return role.body.data.id
  }

  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    // Never depend on seeded order state (other suites mutate it): fall back
    // to placing a fresh pending order when none is listed.
    const list = await call('/api/orders', { headers: admin })
    const pending = list.body.data.items.find((o: { status: string }) => o.status === 'pending')
    if (pending) {
      orderId = pending.id
    } else {
      const products = await call('/api/store/jamicore-store/products?limit=100')
      const product = products.body.data.items.find((i: any) => (i.stock ?? 0) >= 5)
      expect(product).toBeDefined()
      const detail = await call(`/api/store/jamicore-store/products/${product.slug}`)
      const variant = detail.body.data.variants.find((v: any) => (v.inventory ?? 0) >= 1) ?? detail.body.data.variants[0]
      const placed = await call('/api/store/jamicore-store/checkout', {
        method: 'POST',
        headers: jh,
        body: JSON.stringify({
          items: [{ productId: product.id, variantId: variant.id, quantity: 1 }],
          email: `role-spec-${stamp}@example.com`,
          shippingAddress: {
            name: 'Role Spec',
            line1: '1 Test St',
            line2: 'Apt 1',
            city: 'Kuwait City',
            state: 'KW',
            postalCode: '12345',
            country: 'KW',
            phone: '+96500000000'
          },
          paymentMethod: 'cod'
        })
      })
      expect(placed.status).toBe(200)
      orderId = placed.body.data.id
    }
    specRole.id = await createSpecRole()
  })

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(users).where(eq(users.email, email)).catch(() => null)
    }
    // The draft product created in "clearing roleId drops role grants" has no
    // clean-up of its own and otherwise leaks into the seeded merchant's
    // catalog across suite runs, breaking the exact-20 seeded-product
    // assertions elsewhere.
    const [leaked] = await db
      .select()
      .from(products)
      .where(and(like(products.sku, 'ROLDONE-%'), eq(products.status, 'draft')))
      .limit(1)
    if (leaked) {
      await db.delete(productVariants).where(eq(productVariants.productId, leaked.id)).catch(() => null)
      await db.delete(products).where(eq(products.id, leaked.id)).catch(() => null)
    }
  })

  const createRoleStaff = async (roleId: string, permissions: string[] = []) => {
    const email = `role-${seq++}-${stamp}@jamicore.com`
    const res = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Role Staff',
        email,
        password: 'Staffpass-1234',
        role: 'staff',
        roleId,
        permissions
      })
    })
    expect(res.status).toBe(200)
    createdEmails.push(email)
    return { email, auth: await loginAs(email, 'Staffpass-1234') }
  }

  const patchOrderStatus = (auth: Record<string, string>) =>
    call(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { ...auth, ...jh },
      body: JSON.stringify({ status: 'processing' })
    })

  it('a user with no explicit permissions inherits their role grant', async () => {
    const { auth } = await createRoleStaff(specRole.id)
    const patch = await patchOrderStatus(auth)
    expect(patch.status).toBe(200)

    const productsPost = await call('/api/products', {
      method: 'POST',
      headers: { ...auth, ...jh },
      body: JSON.stringify({ sku: `ROLDENIED-${stamp}`, name: `Denied ${stamp}`, price: 1, status: 'draft' })
    })
    expect(productsPost.status).toBe(403)
  })

  it('editing the role changes effective permissions without a new token', async () => {
    const { auth } = await createRoleStaff(specRole.id)
    expect((await patchOrderStatus(auth)).status).toBe(200)

    const updated = await call(`/api/roles/${specRole.id}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ permissions: ['products.create'] })
    })
    expect(updated.status).toBe(200)

    // same request context/token: the role is re-read per request
    expect((await patchOrderStatus(auth)).status).toBe(403)
    const productsPost = await call('/api/products', {
      method: 'POST',
      headers: { ...auth, ...jh },
      body: JSON.stringify({ sku: `ROLDONE-${stamp}`, name: `Done ${stamp}`, price: 1, status: 'draft' })
    })
    expect(productsPost.status).toBe(200)

    // restore the role for the remaining cases
    await call(`/api/roles/${specRole.id}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ permissions: ['orders.update'] })
    })
  })

  it('clearing roleId drops role grants but keeps the per-user overlay', async () => {
    const { email, auth } = await createRoleStaff(specRole.id, ['reports.read'])
    expect((await patchOrderStatus(auth)).status).toBe(200)

    const [row] = await db.select().from(users).where(eq(users.email, email))
    const cleared = await call(`/api/settings/staff/${row.id}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ roleId: null })
    })
    expect(cleared.status).toBe(200)

    // role grant gone → 403; overlay grant (reports.read) unaffected
    expect((await patchOrderStatus(auth)).status).toBe(403)
    const overview = await call('/api/overview', { headers: auth })
    expect(overview.status).toBe(200)
  })

  it('rejects a roleId from another merchant', async () => {
    const bogus = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Bogus Role',
        email: `bogus-role-${stamp}@jamicore.com`,
        password: 'Staffpass-1234',
        role: 'staff',
        roleId: 'nonexistent-role-id' 
      })
    })
    expect(bogus.status).toBe(400)
  })

  it('auth/me exposes roleId + effectivePermissions union', async () => {
    const role = await call('/api/roles', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: `Me-${stamp}`, permissions: ['orders.read'], scope: 'MERCHANT' })
    })
    const meRoleId = role.body.data.id
    const email = `me-role-${stamp}@jamicore.com`
    await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Me Role',
        email,
        password: 'Staffpass-1234',
        role: 'staff',
        roleId: meRoleId,
        permissions: ['settings.read']
      })
    })
    createdEmails.push(email)

    const me = await call('/api/auth/me', { headers: await loginAs(email, 'Staffpass-1234') })
    expect(me.status).toBe(200)
    expect(me.body.data.user.roleId).toBe(meRoleId)
    expect(me.body.data.user.effectivePermissions).toContain('orders.read')
    expect(me.body.data.user.effectivePermissions).toContain('settings.read')
  })
})