import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { hash } from 'bcryptjs'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { merchants, users } from '../src/database/schema'
import { eq } from 'drizzle-orm'
import { ensurePlatformAdmin } from '../src/database/seed-platform-admin'
import { AuditService } from '../src/modules/audit-logs/service'

const ADMIN_EMAIL = 'ops@jamicore.com'
const ADMIN_PASSWORD = 'ops-password-123'

const base = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://localhost${path}`, init))

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const cookieOf = (res: Response): string | null => {
  const setCookies = res.headers.getSetCookie?.() ?? []
  const raw = setCookies.find((c) => c.startsWith('pd.session='))
  return raw?.split(';')[0] ?? null
}

let sessionCookie: string
let merchantId: string

beforeAll(async () => {
  await ensurePlatformAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
  merchantId = merchant.id
})

afterAll(async () => {
  // Restore the seed merchant to the operable state no matter what failed —
  // merchant-lifecycle.test.ts does the same. seed() only runs once per process,
  // so a suspended store would break every later file.
  await db.update(merchants).set({ status: 'active' }).where(eq(merchants.id, merchantId))
})

describe('platform auth', () => {
  it('login returns a pd.session cookie', async () => {
    const res = await base('/api/platform/auth/login', json({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.email).toBe(ADMIN_EMAIL)
    sessionCookie = cookieOf(res)!
    expect(sessionCookie).toBeTruthy()
  })

  it('rejects a bad password', async () => {
    const res = await base('/api/platform/auth/login', json({ email: ADMIN_EMAIL, password: 'wrong-password' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects an unknown email without leaking account existence', async () => {
    const res = await base('/api/platform/auth/login', json({ email: 'nobody@jamicore.com', password: ADMIN_PASSWORD }))
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
  })
})

describe('platform merchant routes', () => {
  it('requires the pd.session cookie', async () => {
    for (const path of ['/api/platform/merchants', '/api/platform/merchants/nope']) {
      const res = await base(path)
      expect(res.status).toBe(401)
    }
  })

  it('lists seeded merchants', async () => {
    const res = await base('/api/platform/merchants', { headers: { cookie: sessionCookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const slugs = body.data.items.map((m: { slug: string }) => m.slug)
    expect(slugs).toContain('jamicore-store')
  })

  it('filters by status', async () => {
    const res = await base('/api/platform/merchants?status=pending', { headers: { cookie: sessionCookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    for (const m of body.data.items) expect(m.status).toBe('pending')
  })

  it('searches by name', async () => {
    const res = await base('/api/platform/merchants?search=jami', { headers: { cookie: sessionCookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.items.length).toBeGreaterThan(0)
    expect(body.data.items.every((m: { name: string }) => m.name.toLowerCase().includes('jami'))).toBe(true)
  })

  it('returns merchant detail + allowed next statuses + audit tail', async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    const res = await base(`/api/platform/merchants/${merchant.id}`, { headers: { cookie: sessionCookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.merchant.status).toBe('active')
    expect(body.data.allowedNextStatuses).toContain('suspended')
    expect(body.data.allowedNextStatuses).toContain('cancelled')
    expect(body.data.allowedNextStatuses).not.toContain('pending')
    expect(body.data.recentAudit).toHaveProperty('items')
  })

  it('404s on an unknown merchant', async () => {
    const res = await base('/api/platform/merchants/does-not-exist', { headers: { cookie: sessionCookie } })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('MERCHANT_NOT_FOUND')
  })
})

describe('platform status changes', () => {
  it('audits a legal active -> suspended transition', async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))

    const res = await base(`/api/platform/merchants/${merchant.id}/status`, {
      ...json({ to: 'suspended', reason: 'Payment fraud flagged by ops' }),
      headers: { 'content-type': 'application/json', cookie: sessionCookie }
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.merchant.status).toBe('suspended')
    expect(body.data.merchant.from).toBe('active')

    const audit = await AuditService.list(db, merchant.id, { action: 'platform.merchant.status_changed' })
    const entry = audit.data.items[0]
    expect(entry).toBeTruthy()
    expect(entry.actorName).toBe(ADMIN_EMAIL)
    expect(entry.actorUserId).toBeNull()
    const meta = entry.metadata as Record<string, unknown>
    expect(meta.from).toBe('active')
    expect(meta.to).toBe('suspended')
    expect(meta.reason).toBe('Payment fraud flagged by ops')
    expect(meta.trigger).toBe('platform abuse/admin action')
  })

  it('blocks illegal transitions', async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    const res = await base(`/api/platform/merchants/${merchant.id}/status`, {
      ...json({ to: 'pending', reason: 'should not be allowed' }),
      headers: { 'content-type': 'application/json', cookie: sessionCookie }
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('ILLEGAL_TRANSITION')
  })

  it('requires a non-blank reason', async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    const res = await base(`/api/platform/merchants/${merchant.id}/status`, {
      ...json({ to: 'suspended', reason: '   ' }),
      headers: { 'content-type': 'application/json', cookie: sessionCookie }
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('REASON_REQUIRED')
  })

  it('re-suspends a subsequent request is still legal via the any -> suspended wildcard', async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    const res = await base(`/api/platform/merchants/${merchant.id}/status`, {
      ...json({ to: 'active', reason: 'abuse claim cleared' }),
      headers: { 'content-type': 'application/json', cookie: sessionCookie }
    })
    // None of 'suspended -> active', 'suspended -> suspended' exist -> illegal/400;
    // a real admin flow would go 'create fresh' or 'archive', proving the state
    // machine (not the UI) is the source of truth.
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('ILLEGAL_TRANSITION')
  })
})

describe('platform offboarding', () => {
  it('cancelling disables all staff and archiving stamps deleted_at (no hard delete)', async () => {
    const stamp = Date.now()
    const [doomed] = await db
      .insert(merchants)
      .values({
        name: `Doomed ${stamp}`,
        slug: `doomed-${stamp}`,
        email: `doomed-${stamp}@jamicore.com`,
        currency: 'USD',
        timezone: 'UTC',
        status: 'active'
      })
      .returning()
    const [staff] = await db
      .insert(users)
      .values({
        merchantId: doomed.id,
        name: 'Doomed Staff',
        email: `doomed-staff-${stamp}@jamicore.com`,
        passwordHash: await hash('password123', 4),
        role: 'staff',
        permissions: [],
        status: 'active'
      })
      .returning()

    const cancel = await base(`/api/platform/merchants/${doomed.id}/status`, {
      ...json({ to: 'cancelled', reason: 'merchant requested closure' }),
      headers: { 'content-type': 'application/json', cookie: sessionCookie }
    })
    expect(cancel.status).toBe(200)
    expect((await cancel.json()).data.merchant.usersDisabled).toBe(1)

    const [disabledStaff] = await db.select().from(users).where(eq(users.id, staff.id))
    expect(disabledStaff.status).toBe('disabled')

    const archive = await base(`/api/platform/merchants/${doomed.id}/status`, {
      ...json({ to: 'archived', reason: 'retention window elapsed' }),
      headers: { 'content-type': 'application/json', cookie: sessionCookie }
    })
    expect(archive.status).toBe(200)

    const [archived] = await db.select().from(merchants).where(eq(merchants.id, doomed.id))
    // Soft-delete only: the row (and its orders/invoices) still exists.
    expect(archived).toBeTruthy()
    expect(archived.status).toBe('archived')
    expect(archived.deletedAt).toBeInstanceOf(Date)

    const detail = await base(`/api/platform/merchants/${doomed.id}`, {
      headers: { cookie: sessionCookie }
    })
    expect((await detail.json()).data.merchant.deletedAt).toBeTruthy()

    // Disabled staff can no longer sign in.
    const login = await base(
      '/api/auth/login',
      json({ email: `doomed-staff-${stamp}@jamicore.com`, password: 'password123' })
    )
    expect(login.status).toBe(403)
  })
})

describe('platform logout', () => {
  it('clears the session cookie', async () => {
    const res = await base('/api/platform/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie }
    })
    expect(res.status).toBe(200)
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith('pd.session='))
    expect(cleared).toBeTruthy()
  })
})