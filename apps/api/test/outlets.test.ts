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
  return {
    authorization: `Bearer ${res.body.data.accessToken}`,
    refreshToken: res.body.data.refreshToken
  }
}

let createdOutletId = ''
let createdRoleId = ''
let cleanedUp = false
let adminToken = ''

describe('Phase 1: outlets, modules, roles, user-outlets', () => {
  let admin: Record<string, string>

  it('loads merchant context from /me', async () => {
    admin = await loginAs('admin@acme.com')
    adminToken = admin.authorization
    const res = await call('/api/auth/me', { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data.allowedOutlets.length).toBeGreaterThan(0)
    expect(res.body.data.enabledModules).toContain('commerce')
  })

  it('admin lists outlets and sees the seeded Main Outlet', async () => {
    const res = await call('/api/outlets', { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data.some((o: { code: string }) => o.code === 'MAIN')).toBe(true)
  })

  it('scopes /me/outlets/... alias to the user', async () => {
    const res = await call('/api/outlets/my', { headers: admin })
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
  })

  it('admin creates, reads, updates and archives an outlet', async () => {
    const code = `BR${Date.now().toString().slice(-8)}`
    const created = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ name: 'Branch Test', code, status: 'active' })
    })
    expect(created.status).toBe(200)
    expect(created.body.data.code).toBe(code)
    createdOutletId = created.body.data.id

    const dup = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ name: 'Duplicate', code })
    })
    expect(dup.status).toBe(409)

    const got = await call(`/api/outlets/${createdOutletId}`, { headers: admin })
    expect(got.status).toBe(200)
    expect(got.body.data.name).toBe('Branch Test')

    const updated = await call(`/api/outlets/${createdOutletId}`, {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ name: 'Branch Renamed' })
    })
    expect(updated.status).toBe(200)
    expect(updated.body.data.name).toBe('Branch Renamed')

    const removed = await call(`/api/outlets/${createdOutletId}`, { method: 'DELETE', headers: admin })
    expect(removed.status).toBe(200)
    expect(removed.body.data.status).toBe('archived')
    cleanedUp = true
  })

  it('admin lists modules (full catalog) and toggles one', async () => {
    const list = await call('/api/modules', { headers: admin })
    expect(list.status).toBe(200)
    expect(list.body.data.find((m: { module: string }) => m.module === 'restaurant')).toEqual(
      expect.objectContaining({ module: 'restaurant' })
    )

    // 'kitchen' is not seeded — toggling creates the row.
    const toggle = await call('/api/modules/kitchen', {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ enabled: true })
    })
    expect(toggle.status).toBe(200)

    const after = await call('/api/modules', { headers: admin })
    expect(after.body.data.find((m: { module: string }) => m.module === 'kitchen').enabled).toBe(true)

    await call('/api/modules/kitchen', {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ enabled: false })
    })
  })

  it('rejects unknown module toggle', async () => {
    const res = await call('/api/modules/not-a-module', {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ enabled: true })
    })
    expect(res.status).toBe(404)
  })

  it('admin manages custom roles; system roles are immutable', async () => {
    const created = await call('/api/roles', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ name: 'Floor Manager', permissions: ['orders.read', 'orders.update'], scope: 'OUTLET' })
    })
    expect(created.status).toBe(200)
    createdRoleId = created.body.data.id

    const dup = await call('/api/roles', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ name: 'Floor Manager' })
    })
    expect(dup.status).toBe(409)

    const updated = await call(`/api/roles/${createdRoleId}`, {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ scope: 'MERCHANT' })
    })
    expect(updated.status).toBe(200)
    expect(updated.body.data.scope).toBe('MERCHANT')

    // System roles (owner/admin/staff) must be immutable on write.
    const system = await call('/api/roles', { headers: admin })
    const owner = system.body.data.find((r: { name: string }) => r.name === 'owner')
    const mutateSystem = await call(`/api/roles/${owner.id}`, {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ scope: 'OUTLET' })
    })
    expect(mutateSystem.status).toBe(400)
  })

  it('admin assigns outlets to a user and lists them', async () => {
    const outlets = await call('/api/outlets', { headers: admin })
    const main = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN')
    const staffLogin = await loginAs('staff@acme.com')
    const staffId = (await call('/api/auth/me', { headers: staffLogin })).body.data.user.id

    const assign = await call(`/api/user-outlets/${staffId}`, {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ outletIds: [main.id] })
    })
    expect(assign.status).toBe(200)
    expect(assign.body.data.outlets).toEqual([main.id])

    const listed = await call(`/api/user-outlets/${staffId}`, { headers: admin })
    expect(listed.status).toBe(200)
    expect(listed.body.data.some((o: { code: string }) => o.code === 'MAIN')).toBe(true)

    // Reset the staff assignment back to none so other tests are unaffected.
    await call(`/api/user-outlets/${staffId}`, {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ outletIds: [] })
    })
  })

  it('enforces module + permission guards for staff', async () => {
    const staff = await loginAs('staff@acme.com')
    const createOutlet = await call('/api/outlets', {
      method: 'POST',
      headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ name: 'Nope', code: 'NOPE' })
    })
    expect(createOutlet.status).toBe(403)

    const toggleModule = await call('/api/modules/kitchen', {
      method: 'PUT',
      headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ enabled: true })
    })
    expect(toggleModule.status).toBe(403)

    const createRole = await call('/api/roles', {
      method: 'POST',
      headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ name: 'Rogue' })
    })
    expect(createRole.status).toBe(403)
  })
})

afterAll(async () => {
  const admin = adminToken ? { authorization: adminToken } : await loginAs('admin@acme.com')
  if (createdRoleId) {
    await call(`/api/roles/${createdRoleId}`, { method: 'DELETE', headers: admin })
  }
  if (!cleanedUp && createdOutletId) {
    await call(`/api/outlets/${createdOutletId}`, { method: 'DELETE', headers: admin })
  }
})
