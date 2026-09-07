import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { users } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const text = await res.text()
  let body: unknown
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
    admin = await loginAs('admin@acme.com')
    const list = await call('/api/orders', { headers: admin })
    orderId = list.body.data.items.find((o: { status: string }) => o.status === 'pending').id
    specRole.id = await createSpecRole()
  })

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(users).where(eq(users.email, email)).catch(() => null)
    }
  })

  const createRoleStaff = async (roleId: string, permissions: string[] = []) => {
    const email = `role-${seq++}-${stamp}@acme.com`
    const res = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Role Staff',
        email,
        password: 'password123',
        role: 'staff',
        roleId,
        permissions
      })
    })
    expect(res.status).toBe(200)
    createdEmails.push(email)
    return { email, auth: await loginAs(email) }
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
        email: `bogus-role-${stamp}@acme.com`,
        password: 'password123',
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
    const email = `me-role-${stamp}@acme.com`
    await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Me Role',
        email,
        password: 'password123',
        role: 'staff',
        roleId: meRoleId,
        permissions: ['settings.read']
      })
    })
    createdEmails.push(email)

    const me = await call('/api/auth/me', { headers: await loginAs(email) })
    expect(me.status).toBe(200)
    expect(me.body.data.user.roleId).toBe(meRoleId)
    expect(me.body.data.user.effectivePermissions).toContain('orders.read')
    expect(me.body.data.user.effectivePermissions).toContain('settings.read')
  })
})