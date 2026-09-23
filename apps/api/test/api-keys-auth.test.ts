import './global-setup'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { apiKeys, merchants, users } from '../src/database/schema'
import { hasPermission, mapApiKeyScopeToPermissions } from '../src/plugins/auth'
import type { AuthContext } from '../src/plugins/auth'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const text = await res.text()
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const jh = { 'Content-Type': 'application/json' }
const stamp = Date.now()
const keyName = (tag: string) => `AKTEST-${stamp}-${tag}`

const loginAs = async (email: string, password = 'password123') => {
  const res = await call('/api/auth/login', {
    method: 'POST',
    headers: jh,
    body: JSON.stringify({ email, password })
  })
  expect(res.status).toBe(200)
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

const createKey = async (
  admin: Record<string, string>,
  input: { name: string; scopes?: string[]; expiresAt?: string }
) => {
  const res = await call('/api/api-keys', {
    method: 'POST',
    headers: { ...admin, ...jh },
    body: JSON.stringify(input)
  })
  return res
}

describe('API key authentication', () => {
  let admin: Record<string, string> = {}
  let merchantId = ''
  let readSecret = ''
  let writeSecret = ''

  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@jamicore.com'))
    merchantId = adminUser.merchantId

    const read = await createKey(admin, {
      name: keyName('read'),
      scopes: ['products:read', 'orders:read']
    })
    expect(read.status).toBe(200)
    readSecret = read.body.data.secret as string
    expect(readSecret).toContain('.')

    const write = await createKey(admin, {
      name: keyName('write'),
      scopes: ['products:write']
    })
    expect(write.status).toBe(200)
    writeSecret = write.body.data.secret as string
  })

  afterAll(async () => {
    await db
      .delete(apiKeys)
      .where(like(apiKeys.name, `AKTEST-${stamp}-%`))
      .catch(() => null)
    // The merchant-suspend test restores status in a finally, but never leave
    // the seeded merchant suspended if something threw unexpectedly.
    await db
      .update(merchants)
      .set({ status: 'active' })
      .where(eq(merchants.id, merchantId))
      .catch(() => null)
  })

  it('rejects unknown scopes at issue time', async () => {
    const res = await createKey(admin, {
      name: keyName('bad-scope'),
      scopes: ['products:read', 'bogus:scope']
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_API_KEY_SCOPE')
  })

  it('issues valid default scopes when none are given', async () => {
    const res = await createKey(admin, { name: keyName('defaults') })
    expect(res.status).toBe(200)
    expect(res.body.data.key.scopes).toEqual(['orders:read', 'products:read'])
  })

  it('authenticates a valid key (read scopes can GET products)', async () => {
    const res = await call('/api/products', {
      headers: { 'x-api-key': readSecret }
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.items).toBeArray()
  })

  it('rejects a tampered secret with 401', async () => {
    const prefix = readSecret.slice(0, readSecret.indexOf('.'))
    const res = await call('/api/products', {
      headers: { 'x-api-key': `${prefix}.${'0'.repeat(64)}` }
    })
    expect(res.status).toBe(401)
  })

  it('rejects a malformed key with 401', async () => {
    const res = await call('/api/products', {
      headers: { 'x-api-key': 'not-a-key' }
    })
    expect(res.status).toBe(401)
  })

  it('rejects an expired key with 401', async () => {
    const created = await createKey(admin, {
      name: keyName('expired'),
      scopes: ['products:read'],
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    })
    expect(created.status).toBe(200)
    const res = await call('/api/products', {
      headers: { 'x-api-key': created.body.data.secret }
    })
    expect(res.status).toBe(401)
  })

  it('rejects a revoked key with 401', async () => {
    const created = await createKey(admin, {
      name: keyName('revoked'),
      scopes: ['products:read']
    })
    expect(created.status).toBe(200)
    const del = await call(`/api/api-keys/${created.body.data.key.id}`, {
      method: 'DELETE',
      headers: admin
    })
    expect(del.status).toBe(200)
    const res = await call('/api/products', {
      headers: { 'x-api-key': created.body.data.secret }
    })
    expect(res.status).toBe(401)
  })

  it('rejects keys of a non-operational (suspended) merchant with 401', async () => {
    await db.update(merchants).set({ status: 'suspended' }).where(eq(merchants.id, merchantId))
    try {
      const res = await call('/api/products', {
        headers: { 'x-api-key': readSecret }
      })
      expect(res.status).toBe(401)
    } finally {
      await db.update(merchants).set({ status: 'active' }).where(eq(merchants.id, merchantId))
    }
  })

  it('denies a read-only key on POST /api/products (403)', async () => {
    const res = await call('/api/products', {
      method: 'POST',
      headers: { 'x-api-key': readSecret, ...jh },
      body: JSON.stringify({ name: 'AKTEST denied', price: 9.99 })
    })
    expect(res.status).toBe(403)
  })

  it('lets a write-scoped key create a product', async () => {
    const created = await call('/api/products', {
      method: 'POST',
      headers: { 'x-api-key': writeSecret, ...jh },
      body: JSON.stringify({ name: `AKTEST Widget ${stamp}`, price: 19.99 })
    })
    expect(created.status).toBe(200)
    // Cleanup so the seeded catalog stays at exactly 20 products for other files.
    const { products, productVariants } = await import('../src/database/schema')
    await db
      .delete(productVariants)
      .where(eq(productVariants.productId, created.body.data.id))
      .catch(() => null)
    await db.delete(products).where(eq(products.id, created.body.data.id)).catch(() => null)
  })
})

describe('API key scope → permission mapping', () => {
  const apiAuth = (scopes: string[]): AuthContext =>
    ({
      user: { id: 'u1', role: 'owner', merchantId: 'm1', status: 'active', permissions: [] },
      merchant: { id: 'm1' },
      role: null,
      db: {} as AuthContext['db'],
      close: async () => {},
      apiKey: { id: 'k1', name: 'test', scopes }
    }) as unknown as AuthContext

  it('expands read and write scopes to dotted permissions', () => {
    expect(mapApiKeyScopeToPermissions('products:read')).toEqual(['products.read'])
    expect(mapApiKeyScopeToPermissions('products:write')).toEqual([
      'products.read',
      'products.create',
      'products.update',
      'products.delete'
    ])
    expect(mapApiKeyScopeToPermissions('orders:write')).toEqual([
      'orders.read',
      'orders.create',
      'orders.update',
      'orders.cancel'
    ])
    expect(mapApiKeyScopeToPermissions('nope:scope')).toEqual([])
  })

  it('does not let the owner admin-bypass apply to API keys', () => {
    const readOnly = apiAuth(['products:read'])
    expect(hasPermission(readOnly, 'products.read')).toBe(true)
    expect(hasPermission(readOnly, 'products.create')).toBe(false)
    expect(hasPermission(readOnly, 'settings.manage')).toBe(false)
    expect(hasPermission(apiAuth(['orders:write']), 'orders.cancel')).toBe(true)
  })
})
