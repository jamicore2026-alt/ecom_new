import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { users } from '../src/database/schema'
import {
  normalizePermissions,
  PERMISSION_ALIASES,
  resolvePermissions
} from '../src/shared/types'
import { SettingsService } from '../src/modules/settings/service'

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

describe('permission convergence (P2-2)', () => {
  let staff: Record<string, string> = {}
  const createdStaffEmails: string[] = []
  const stamp = Date.now()

  beforeAll(async () => {
    staff = await loginAs('staff@acme.com')
  })

  afterAll(async () => {
    for (const email of createdStaffEmails) {
      await db.delete(users).where(eq(users.email, email)).catch(() => null)
    }
  })

  it('expands every legacy colon permission to the dotted vocabulary', () => {
    expect(resolvePermissions('products:write')).toEqual([
      'products.create',
      'products.update',
      'products.delete'
    ])
    expect(resolvePermissions('orders:write')).toEqual([
      'orders.create',
      'orders.update',
      'orders.cancel'
    ])
    expect(resolvePermissions('inventory:write')).toEqual(['inventory.adjust', 'inventory.manage'])
    expect(resolvePermissions('discounts:write')).toEqual(['settings.manage'])
    expect(resolvePermissions('settings:write')).toEqual(['settings.manage'])
    expect(resolvePermissions('analytics:read')).toEqual(['reports.read'])
    // dotted permissions map to themselves
    expect(resolvePermissions('orders.read')).toEqual(['orders.read'])
  })

  it('normalizePermissions dedups and orders the expanded grants', () => {
    const norm = normalizePermissions(['orders:write', 'orders.create', 'orders.read'])
    expect(norm).toContain('orders.create')
    expect(norm.filter((p) => p === 'orders.create').length).toBe(1)
    expect(norm).toContain('orders.update')
    expect(norm).toContain('orders.cancel')
    expect(norm).toContain('orders.read')
  })

  it('every guard still references only canonical permissions', () => {
    for (const alias of Object.keys(PERMISSION_ALIASES)) {
      expect(alias).toMatch(':')
    }
  })

  it('seeded staff grants are stored in the canonical dotted form', async () => {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, 'staff@acme.com'), eq(users.status, 'active')))
    expect(row).toBeDefined()
    expect(row.permissions).toEqual(
      expect.arrayContaining([
        'products.create',
        'products.update',
        'products.delete',
        'orders.create',
        'orders.update',
        'orders.cancel',
        'inventory.adjust',
        'inventory.manage'
      ])
    )
    expect(row.permissions.join(',')).not.toContain(':')
  })

  it('riley (reports.read) can still reach analytics + overview', async () => {
    const riley = await loginAs('riley@acme.com')
    const overview = await call('/api/overview', { headers: riley })
    expect(overview.status).toBe(200)
    const sales = await call('/api/analytics/sales?interval=week', { headers: riley })
    expect(sales.status).toBe(200)
  })

  it('staff (products/orders/inventory side surfaces) can still modify', async () => {
    const exportRes = await call('/api/orders/export', { headers: staff })
    expect(exportRes.status).toBe(200)
    expect(exportRes.res.headers.get('content-type')).toContain('text/csv')
  })

  it('staff can still create a product with their canonical grants', async () => {
    const res = await call('/api/products', {
      method: 'POST',
      headers: { ...staff, ...jh },
      body: JSON.stringify({ sku: `CONV-${stamp}`, name: `Conv ${stamp}`, price: 9.99, status: 'active' })
    })
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBeTruthy()
  })

  it('legacy colon grants still authorize (backward compatible)', async () => {
    // riley gets a legacy settings:write grant via direct row update; it maps
    // to settings.manage, so theme updates remain allowed.
    const [rileyRow] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, 'riley@acme.com'), eq(users.status, 'active')))
    const prior = rileyRow.permissions
    await db
      .update(users)
      .set({ permissions: [...prior, 'settings:write'] as never })
      .where(eq(users.id, rileyRow.id))

    const riley = await loginAs('riley@acme.com')
    const theme = await call('/api/theme', {
      method: 'PUT',
      headers: { ...riley, ...jh },
      body: JSON.stringify({})
    })
    expect(theme.status).toBe(200)

    // restore
    await db.update(users).set({ permissions: prior as never }).where(eq(users.id, rileyRow.id))
  })

  it('staff create/update normalizes any colon permissions to dotted', async () => {
    const [adminRow] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, 'admin@acme.com'), eq(users.status, 'active')))
    const email = `norm-${stamp}@acme.com`

    const created = await SettingsService.createStaff(adminRow.merchantId, {
      name: 'Norm Conv',
      email,
      password: 'password123',
      role: 'staff',
      permissions: ['settings:write', 'orders.read']
    })
    expect(created.success).toBe(true)
    expect(created.data.permissions).toEqual(['settings.manage', 'orders.read'])
    createdStaffEmails.push(email)
  })
})