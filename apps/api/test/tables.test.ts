import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'bun:test'
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
const ids = { section: '', t1: '', t2: '', t3: '' }
const stamp = Date.now().toString(36)

/**
 * Reset all three test tables to a clean AVAILABLE state: close any OPEN
 * session, then drive the (validated) table state back to AVAILABLE. This makes
 * every test independent of the previous one's lingering party state.
 */
async function freeTables() {
  const all: string[] = []
  const sessions = await call('/api/table-sessions?status=OPEN', { headers: admin })
  for (const s of sessions.body.data ?? []) {
    if ([ids.t1, ids.t2, ids.t3].includes(s.tableId)) all.push(s.id)
  }
  for (const sid of all) await call(`/api/table-sessions/${sid}/close`, { method: 'POST', headers: admin })
  for (const tid of [ids.t1, ids.t2, ids.t3]) {
    const t = await call(`/api/tables/${tid}`, { headers: admin })
    const st = t.body.data.status
    if (st === 'ORDERING') {
      await call(`/api/tables/${tid}/status`, { method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'OCCUPIED' }) })
      await call(`/api/tables/${tid}/status`, { method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'AVAILABLE' }) })
    } else {
      await call(`/api/tables/${tid}/status`, {
        method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'AVAILABLE' })
      }).catch(() => null)
    }
  }
}

describe('Phase 5: dine-in tables + QR', () => {
  beforeAll(async () => {
    admin = await loginAs('admin@acme.com')
    const outlets = await call('/api/outlets', { headers: admin })
    resOutletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    const section = await call('/api/table-sections', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ outletId: resOutletId, name: `Test Floor ${stamp}`, sortOrder: 99 })
    })
    ids.section = section.body.data.id

    for (let i = 1; i <= 3; i++) {
      const table = await call('/api/tables', {
        method: 'POST',
        headers: { ...admin, ...jsonHeaders },
        body: JSON.stringify({ outletId: resOutletId, sectionId: ids.section, name: `Tst${stamp}${i}`, code: `TX${stamp}${i}`, seats: 4 })
      })
      expect(table.status).toBe(200)
      if (i === 1) ids.t1 = table.body.data.id
      else if (i === 2) ids.t2 = table.body.data.id
      else ids.t3 = table.body.data.id
      expect(table.body.data.qrToken).toBeTruthy()
    }
  }, 15000)

  beforeEach(async () => {
    await freeTables()
  }, 15000)

  it('validates table state transitions (no raw status writes)', async () => {
    const ok = await call(`/api/tables/${ids.t1}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ORDERING' })
    })
    expect(ok.status).toBe(200)
    expect(ok.body.data.status).toBe('ORDERING')
    const bad = await call(`/api/tables/${ids.t1}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'CLEANING' })
    })
    expect(bad.status).toBe(409)
    const bogus = await call(`/api/tables/${ids.t1}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'FANCY' })
    })
    expect(bogus.status).toBe(400)
  })

  it('creates + updates + deletes a table section', async () => {
    const created = await call('/api/table-sections', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ outletId: resOutletId, name: `TmpSec ${stamp}`, sortOrder: 5 })
    })
    expect(created.status).toBe(200)
    const id = created.body.data.id
    const dup = await call('/api/table-sections', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ outletId: resOutletId, name: `TmpSec ${stamp}` })
    })
    expect(dup.status).toBe(409)
    const updated = await call(`/api/table-sections/${id}`, {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'inactive' })
    })
    expect(updated.status).toBe(200)
    expect(updated.body.data.status).toBe('inactive')
    const del = await call(`/api/table-sections/${id}`, { method: 'DELETE', headers: admin })
    expect(del.status).toBe(200)
  })

  it('opens a session: table ORDERING, session OPEN; reopen blocked', async () => {
    const open = await call('/api/table-sessions', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: ids.t1, guests: 3 })
    })
    expect(open.status).toBe(200)
    expect(open.body.data.status).toBe('OPEN')
    expect(open.body.data.tableId).toBe(ids.t1)
    const table = await call(`/api/tables/${ids.t1}`, { headers: admin })
    expect(table.body.data.status).toBe('ORDERING')

    const reopen = await call('/api/table-sessions', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: ids.t1, guests: 2 })
    })
    expect(reopen.status).toBe(409)
    expect(reopen.body.error.code).toBe('TABLE_OCCUPIED')

    const closed = await call(`/api/table-sessions/${open.body.data.id}/close`, { method: 'POST', headers: admin })
    expect(closed.status).toBe(200)
    expect(closed.body.data.status).toBe('CLOSED')
    const after = await call(`/api/tables/${ids.t1}`, { headers: admin })
    expect(after.body.data.status).toBe('CLEANING')
  })

  it('moves an open session to another free table', async () => {
    const open = await call('/api/table-sessions', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: ids.t1, guests: 2 })
    })
    const sessionId = open.body.data.id
    const moved = await call(`/api/table-sessions/${sessionId}/move`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ toTableId: ids.t2 })
    })
    expect(moved.status).toBe(200)
    expect(moved.body.data.tableId).toBe(ids.t2)
    const t2 = await call(`/api/tables/${ids.t2}`, { headers: admin })
    expect(t2.body.data.status).toBe('ORDERING')
    await call(`/api/table-sessions/${sessionId}/close`, { method: 'POST', headers: admin })
  })

  it('merges two open sessions into a target', async () => {
    const s1 = await call('/api/table-sessions', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: ids.t1, guests: 2 })
    })
    const s2 = await call('/api/table-sessions', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: ids.t3, guests: 1 })
    })
    const targetId = s1.body.data.id
    const sourceId = s2.body.data.id

    const merged = await call(`/api/table-sessions/${targetId}/merge`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ sessionIds: [sourceId] })
    })
    expect(merged.status).toBe(200)
    expect(merged.body.data.guests).toBe(3)
    const source = await call(`/api/table-sessions/${sourceId}`, { headers: admin })
    expect(source.body.data.status).toBe('CLOSED')
    const t3 = await call(`/api/tables/${ids.t3}`, { headers: admin })
    expect(t3.body.data.status).toBe('CLEANING')
  })

  it('splits a party into a new session on another table', async () => {
    const origin = await call('/api/table-sessions', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: ids.t3, guests: 4 })
    })
    expect(origin.status).toBe(200)
    const originId = origin.body.data.id

    const split = await call(`/api/table-sessions/${originId}/split`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ toTableId: ids.t2, guests: 2 })
    })
    expect(split.status).toBe(200)
    expect(split.body.data.session.guests).toBe(2)
    expect(split.body.data.splitInto.guests).toBe(2)
    expect(split.body.data.splitInto.tableId).toBe(ids.t2)
  })

  it('attaches a dine-in food order to an open session (and blocks re-attach)', async () => {
    const menu = await call('/api/menu', { headers: admin })
    const menuItem = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active')
    const order = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DINE_IN', outletId: resOutletId, items: [{ menuItemId: menuItem.id, quantity: 1 }] })
    })
    expect(order.status).toBe(200)
    const orderId = order.body.data.id

    const session = await call('/api/table-sessions', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: ids.t1, guests: 2 })
    })
    const sessionId = session.body.data.id

    const attach = await call(`/api/table-sessions/${sessionId}/orders`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ orderId })
    })
    expect(attach.status).toBe(200)

    const orderCheck = await call(`/api/food-orders/${orderId}`, { headers: admin })
    expect(orderCheck.body.data.tableSessionId).toBe(sessionId)

    const reattach = await call(`/api/table-sessions/${sessionId}/orders`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ orderId })
    })
    expect(reattach.status).toBe(409)
  })

  it('serves public QR table context with NO auth and no private data', async () => {
    const table = await call(`/api/tables/${ids.t1}`, { headers: admin })
    const token = table.body.data.qrToken

    const pub = await app.handle(new Request(`http://localhost/api/table-qr/${token}`))
    expect(pub.status).toBe(200)
    const body = await pub.json()
    expect(body.success).toBe(true)
    expect(body.data.table.id).toBe(ids.t1)
    expect(body.data.outlet.name).toBeTruthy()
    expect(Array.isArray(body.data.items)).toBe(true)
    const serialized = JSON.stringify(body.data)
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('merchant')
  })

  it('denies table management to staff without tables.manage', async () => {
    const staff = await loginAs('staff@acme.com')
    const res = await call('/api/tables', {
      method: 'POST',
      headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ outletId: resOutletId, name: 'Nope', code: 'NOPE', seats: 2 })
    })
    expect(res.status).toBe(403)
  })
})

afterAll(async () => {
  await freeTables().catch(() => null)
})
