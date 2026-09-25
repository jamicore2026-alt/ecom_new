import { describe, expect, it, beforeAll } from 'bun:test'
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
let tableA = ''
let tableB = ''
const stamp = Date.now().toString(36)

describe('Tables gaps: positions, split lines, reservations, turn-time', () => {
  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    const outlets = await call('/api/outlets', { headers: admin })
    resOutletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id
    const mk = async (suffix: string) => {
      const r = await call('/api/tables', {
        method: 'POST', headers: { ...admin, ...jsonHeaders },
        body: JSON.stringify({ outletId: resOutletId, name: `Gap${stamp}${suffix}`, code: `GG${stamp}${suffix}`, seats: 4 })
      })
      expect(r.status).toBe(200)
      return r.body.data.id as string
    }
    tableA = await mk('A')
    tableB = await mk('B')
  }, 20000)

  it('persists floor-plan positions and returns them on list/get', async () => {
    const set = await call(`/api/tables/${tableA}/position`, {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ posX: 25, posY: 60 })
    })
    expect(set.status).toBe(200)
    expect(set.body.data.posX).toBe(25)
    expect(set.body.data.posY).toBe(60)
    const got = await call(`/api/tables/${tableA}`, { headers: admin })
    expect(got.body.data.posX).toBe(25)
    const bad = await call(`/api/tables/${tableA}/position`, {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ posX: 101, posY: 0 })
    })
    expect(bad.status).toBe(400)
    // reset
    await call(`/api/tables/${tableA}/position`, {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ posX: null, posY: null })
    })
  })

  it('split moves selected order lines to the new session', async () => {
    const menu = await call('/api/menu', { headers: admin })
    const item = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active')
    // Free both tables first (close sessions, then walk the state machine home).
    for (const tid of [tableA, tableB]) {
      const open = await call('/api/table-sessions?status=OPEN', { headers: admin })
      for (const s of open.body.data.filter((x: { tableId: string }) => x.tableId === tid)) {
        await call(`/api/table-sessions/${s.id}/close`, { method: 'POST', headers: admin })
      }
      const setStatus = (status: string) => call(`/api/tables/${tid}/status`, { method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status }) })
      const cur = await call(`/api/tables/${tid}`, { headers: admin })
      const st = cur.body.data.status
      if (st === 'ORDERING') {
        await setStatus('OCCUPIED')
        await setStatus('AVAILABLE')
      } else if (st === 'CLEANING' || st === 'RESERVED' || st === 'PAYMENT_PENDING') {
        await setStatus('AVAILABLE')
      } else if (st !== 'AVAILABLE') {
        await setStatus('AVAILABLE').catch(() => null)
      }
    }
    const sess = await call('/api/table-sessions', {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: tableA, guests: 4 })
    })
    expect(sess.status).toBe(200)
    const sessionId = sess.body.data.id
    const order = await call('/api/food-orders', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ orderType: 'DINE_IN', outletId: resOutletId, items: [{ menuItemId: item.id, quantity: 3 }] })
    })
    expect(order.status).toBe(200)
    await call(`/api/table-sessions/${sessionId}/orders`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ orderId: order.body.data.id })
    })
    const full = await call(`/api/food-orders/${order.body.data.id}`, { headers: admin })
    const lineIds: string[] = full.body.data.items.map((l: { id: string }) => l.id)
    // Reduce to single line qty 1? Just move the first line.
    const split = await call(`/api/table-sessions/${sessionId}/split`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ toTableId: tableB, guests: 1, orderItemIds: [lineIds[0]] })
    })
    expect(split.status).toBe(200)
    expect(split.body.data.movedLines).toBe(1)
    const moved = await call(`/api/food-orders/${order.body.data.id}`, { headers: admin })
    expect(moved.body.data.items.some((l: { id: string }) => l.id === lineIds[0])).toBe(false)
    // Cleanup.
    const open = await call('/api/table-sessions?status=OPEN', { headers: admin })
    for (const s of open.body.data.filter((x: { tableId: string }) => [tableA, tableB].includes(x.tableId))) {
      await call(`/api/table-sessions/${s.id}/close`, { method: 'POST', headers: admin })
    }
  })

  it('reservations CRUD + waitlist + history + assign', async () => {
    const at = new Date(Date.now() + 86400_000).toISOString()
    const created = await call('/api/reservations', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ outletId: resOutletId, guestName: `Gap Guest ${stamp}`, guestPhone: `555-${stamp}`, partySize: 3, reservedAt: at })
    })
    expect(created.status).toBe(200)
    const id = created.body.data.id

    const wait = await call('/api/reservations', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ outletId: resOutletId, guestName: `Wait Guest ${stamp}`, guestPhone: `555-${stamp}`, partySize: 2, reservedAt: at, status: 'waitlist' })
    })
    expect(wait.status).toBe(200)

    const wl = await call('/api/reservations/waitlist', { headers: admin })
    expect(wl.status).toBe(200)
    expect(wl.body.data.some((r: { id: string }) => r.id === wait.body.data.id)).toBe(true)

    const hist = await call(`/api/reservations/history?phone=${encodeURIComponent(`555-${stamp}`)}`, { headers: admin })
    expect(hist.status).toBe(200)
    expect(hist.body.data.count).toBeGreaterThanOrEqual(2)

    const seated = await call(`/api/reservations/${id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'seated' })
    })
    expect(seated.status).toBe(200)
    expect(seated.body.data.status).toBe('seated')

    const badStatus = await call(`/api/reservations/${id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'bogus' })
    })
    expect(badStatus.status).toBe(400)

    const assigned = await call(`/api/reservations/${id}/assign`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ tableId: tableA })
    })
    expect(assigned.status).toBe(200)
    expect(assigned.body.data.tableId).toBe(tableA)

    const day = new Date(Date.now() + 86400_000)
    const from = new Date(day); from.setHours(0, 0, 0, 0)
    const to = new Date(day); to.setHours(23, 59, 59, 999)
    const list = await call(`/api/reservations?outletId=${resOutletId}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { headers: admin })
    expect(list.status).toBe(200)
    expect(list.body.data.some((r: { id: string }) => r.id === id)).toBe(true)

    const del = await call(`/api/reservations/${wait.body.data.id}`, { method: 'DELETE', headers: admin })
    expect(del.status).toBe(200)
    const del2 = await call(`/api/reservations/${id}`, { method: 'DELETE', headers: admin })
    expect(del2.status).toBe(200)
  })

  it('turn-time report returns avg/median minutes', async () => {
    const res = await call('/api/tables/reports/turn-time', { headers: admin })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    for (const row of res.body.data) {
      expect(typeof row.avgMin).toBe('number')
      expect(typeof row.medianMin).toBe('number')
      expect(typeof row.sessions).toBe('number')
    }
  })
})
