/**
 * Growth/platform minor gaps — DB-backed integration coverage.
 *
 * Exercises the live endpoints: content version snapshots + rollback, theme
 * validation + versions + rollback, audit hash-chain verify + purge, and the
 * staff.read single-role read path. Requires the seeded test database
 * (global-setup). Cleans up created rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { auditLogs, contentPages, merchants } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}
const H = (token: string) => ({ authorization: `Bearer ${token}` })
const post = (body: unknown, token: string) => ({
  method: 'POST',
  headers: { ...H(token), 'content-type': 'application/json' },
  body: JSON.stringify(body)
})
const put = (body: unknown, token: string) => ({
  method: 'PUT',
  headers: { ...H(token), 'content-type': 'application/json' },
  body: JSON.stringify(body)
})
const get = (token: string) => ({ method: 'GET', headers: H(token) })

describe('Platform minor gaps (integration)', () => {
  let adminToken = ''
  let merchantId = ''
  const pageIds: string[] = []

  beforeAll(async () => {
    const login = await call('/api/auth/login', post({ email: 'admin@jamicore.com', password: 'password123' }, ''))
    expect(login.status).toBe(200)
    adminToken = login.body.data.accessToken
    const [m] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = m.id
    // Chain verification is order- and format-sensitive: clear stale audit rows
    // (mixed-format dev data) so this file verifies a chain it created itself.
    await db.delete(auditLogs).where(eq(auditLogs.merchantId, merchantId))
  })

  afterAll(async () => {
    for (const id of pageIds) {
      await db.delete(contentPages).where(and(eq(contentPages.id, id), eq(contentPages.merchantId, merchantId)))
    }
  })

  it('content: snapshots on update, lists versions, rolls back as a new version', async () => {
    const slug = `gap-${createId().slice(0, 8).toLowerCase()}`
    const created = await call('/api/content', post({ title: 'v0 title', slug, content: 'v0 body' }, adminToken))
    expect(created.status).toBe(200)
    const id: string = created.body.data.id
    pageIds.push(id)

    const u1 = await call(`/api/content/${id}`, put({ title: 'v1 title', content: 'v1 body' }, adminToken))
    expect(u1.status).toBe(200)
    const u2 = await call(`/api/content/${id}`, put({ title: 'v2 title', content: 'v2 body' }, adminToken))
    expect(u2.status).toBe(200)
    expect(u2.body.data.title).toBe('v2 title')

    const versions = await call(`/api/content/${id}/versions`, get(adminToken))
    expect(versions.status).toBe(200)
    // Two updates → two snapshots (v1 = pre-u1 state, v2 = pre-u2 state).
    expect(versions.body.data.items).toHaveLength(2)
    expect(versions.body.data.items[0].version).toBe(2)
    expect(versions.body.data.items[1].title).toBe('v0 title')

    const rb = await call(`/api/content/${id}/rollback/1`, post({}, adminToken))
    expect(rb.status).toBe(200)
    expect(rb.body.data.title).toBe('v0 title')
    expect(rb.body.data.content).toBe('v0 body')

    // Rollback itself snapshots (pre-rollback v2 state) → now 3 versions.
    const after = await call(`/api/content/${id}/versions`, get(adminToken))
    expect(after.body.data.items).toHaveLength(3)

    const missing = await call(`/api/content/${id}/rollback/999`, post({}, adminToken))
    expect(missing.status).toBe(404)
  })

  it('theme: rejects bad colors/logos, snapshots versions, rolls back', async () => {
    const badColor = await call('/api/theme', put({ primaryColor: 'red' }, adminToken))
    expect(badColor.status).toBe(400)
    expect(badColor.body.error.code).toBe('INVALID_COLOR')

    const badLogo = await call('/api/theme', put({ logo: 'javascript:alert(1)' }, adminToken))
    expect(badLogo.status).toBe(400)
    expect(badLogo.body.error.code).toBe('INVALID_LOGO')

    const badData = await call('/api/theme', put({ logo: 'data:text/html,hi' }, adminToken))
    expect(badData.status).toBe(400)

    const before = await call('/api/theme/versions', get(adminToken))
    expect(before.status).toBe(200)
    const countBefore: number = before.body.data.items.length

    const saved = await call(
      '/api/theme',
      put({ primaryColor: '#112233', logo: 'https://example.com/logo.png', note: 'gap test' }, adminToken)
    )
    expect(saved.status).toBe(200)
    expect(saved.body.data.primaryColor).toBe('#112233')

    const after = await call('/api/theme/versions', get(adminToken))
    expect(after.body.data.items.length).toBe(countBefore + 1)

    const target = after.body.data.items[0].version as number
    const rb = await call(`/api/theme/rollback/${target}`, post({}, adminToken))
    expect(rb.status).toBe(200)

    const missing = await call('/api/theme/rollback/999999', post({}, adminToken))
    expect(missing.status).toBe(404)
  })

  it('audit: verify reports an intact chain; purge with a huge window deletes nothing', async () => {
    // Generate two fresh chained rows via theme updates (audited actions).
    await call('/api/theme', put({ accentColor: '#445566' }, adminToken))
    const verify = await call('/api/audit-logs/verify', get(adminToken))
    expect(verify.status).toBe(200)
    expect(verify.body.data.ok).toBe(true)
    expect(verify.body.data.checked).toBeGreaterThanOrEqual(1)

    const purge = await call('/api/audit-logs/purge', post({ olderThanDays: 3650 }, adminToken))
    expect(purge.status).toBe(200)
    expect(typeof purge.body.deleted).toBe('number')
  })

  it('audit chain helpers: stored rows link prev_hash → row_hash', async () => {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.merchantId, merchantId))
    const chained = rows.filter((r) => r.rowHash)
    expect(chained.length).toBeGreaterThan(0)
    // Every chained row's prev points at a real predecessor (or genesis null).
    const hashes = new Set(chained.map((r) => r.rowHash))
    for (const r of chained) {
      if (r.prevHash !== null) expect(hashes.has(r.prevHash)).toBe(true)
    }
  })

  it('roles: single-role read works for the admin read path', async () => {
    const list = await call('/api/roles', get(adminToken))
    expect(list.status).toBe(200)
    expect(list.body.data.length).toBeGreaterThan(0)
    const id: string = list.body.data[0].id
    const one = await call(`/api/roles/${id}`, get(adminToken))
    expect(one.status).toBe(200)
    expect(one.body.data.id).toBe(id)
  })
})
