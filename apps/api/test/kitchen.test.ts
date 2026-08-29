import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
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
let staff: Record<string, string> = {}
let resOutletId = ''
const stamp = Date.now().toString(36)
let stationId = ''
let stationName = ''
let menuItemId = ''

async function makeOrder() {
  const order = await call('/api/food-orders', {
    method: 'POST',
    headers: { ...admin, ...jsonHeaders },
    body: JSON.stringify({ orderType: 'DINE_IN', outletId: resOutletId, items: [{ menuItemId, quantity: 2 }] })
  })
  expect(order.status).toBe(200)
  return order.body.data.id
}

async function generate(orderId: string) {
  const res = await call(`/api/kitchen/orders/${orderId}/tickets`, {
    method: 'POST',
    headers: { ...admin, ...jsonHeaders },
    body: JSON.stringify({})
  })
  expect(res.status).toBe(200)
  return res.body.data.items
}

async function getTicket(id: string) {
  const res = await call(`/api/kitchen/tickets/${id}`, { headers: admin })
  expect(res.status).toBe(200)
  return res.body.data
}

describe('Phase 6: kitchen + KOT + KDS', () => {
  beforeAll(async () => {
    admin = await loginAs('admin@acme.com')
    staff = await loginAs('staff@acme.com')
    const outlets = await call('/api/outlets', { headers: admin })
    resOutletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    const mod = await call('/api/modules/kitchen', {
      method: 'PUT', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ enabled: true })
    })
    expect(mod.status).toBe(200)

    const station = await call('/api/kitchen-stations', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ outletId: resOutletId, name: `Test ${stamp}`, prepSlaMin: 10, sortOrder: 90 })
    })
    expect(station.status).toBe(200)
    stationId = station.body.data.id
    stationName = station.body.data.name

    const menu = await call('/api/menu', { headers: admin })
    const item = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active')
    menuItemId = item.id
    const routed = await call(`/api/menu/${menuItemId}`, {
      method: 'PUT',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ kitchenStation: stationName })
    })
    expect(routed.status).toBe(200)
  }, 20000)

  it('generates a KOT for a food order, routed to its station, status NEW', async () => {
    const orderId = await makeOrder()
    const tickets = await generate(orderId)
    expect(tickets.length).toBe(1)
    const ticket = tickets[0]
    expect(ticket.stationId).toBe(stationId)
    expect(ticket.stationName).toBe(stationName)
    expect(ticket.status).toBe('NEW')
    const detail = await getTicket(ticket.id)
    expect(detail.items[0].name).toBeTruthy()
    expect(detail.items[0].quantity).toBe(2)
  })

  it('KOT generation is idempotent per (order, station)', async () => {
    const orderId = await makeOrder()
    await generate(orderId)
    const again = await generate(orderId)
    expect(again.length).toBe(1)
  })

  it('validates KOT transitions along the state machine', async () => {
    const orderId = await makeOrder()
    const tickets = await generate(orderId)
    const ticket = tickets[0]

    const accepted = await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ACCEPTED' })
    })
    expect(accepted.status).toBe(200)
    expect(accepted.body.data.status).toBe('ACCEPTED')

    const badJump = await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'READY' })
    })
    expect(badJump.status).toBe(409)

    const preparing = await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'PREPARING' })
    })
    expect(preparing.status).toBe(200)
    expect(preparing.body.data.status).toBe('PREPARING')
    expect(preparing.body.data.startedAt).toBeTruthy()
  })

  it('bump marks a ticket READY and readyAt is set', async () => {
    const orderId = await makeOrder()
    const tickets = await generate(orderId)
    const ticket = tickets[0]
    await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ACCEPTED' })
    })
    await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'PREPARING' })
    })
    const bumped = await call(`/api/kitchen/tickets/${ticket.id}/bump`, { method: 'POST', headers: admin })
    expect(bumped.status).toBe(200)
    expect(bumped.body.data.status).toBe('READY')
    expect(bumped.body.data.readyAt).toBeTruthy()
    expect(bumped.body.data.items.every((it: { status: string }) => it.status === 'READY')).toBe(true)
  })

  it('item-level completion auto-bumps when all lines are done', async () => {
    const orderId = await makeOrder()
    const tickets = await generate(orderId)
    const ticket = tickets[0]
    await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ACCEPTED' })
    })
    await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'PREPARING' })
    })
    const detail = await getTicket(ticket.id)
    const itemId = detail.items[0].id

    const done = await call(`/api/kitchen/tickets/${ticket.id}/items/${itemId}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'DONE' })
    })
    expect(done.status).toBe(200)
    expect(done.body.data.status).toBe('READY')
  })

  it('recall returns a PREPARING ticket to RECALLED', async () => {
    const orderId = await makeOrder()
    const tickets = await generate(orderId)
    const ticket = tickets[0]
    await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'ACCEPTED' })
    })
    await call(`/api/kitchen/tickets/${ticket.id}/status`, {
      method: 'POST', headers: { ...admin, ...jsonHeaders }, body: JSON.stringify({ status: 'PREPARING' })
    })
    const recalled = await call(`/api/kitchen/tickets/${ticket.id}/recall`, { method: 'POST', headers: admin })
    expect(recalled.status).toBe(200)
    expect(recalled.body.data.status).toBe('RECALLED')
  })

  it('KDS board lists open tickets grouped by station', async () => {
    const orderId = await makeOrder()
    await generate(orderId)
    const board = await call('/api/kitchen/kds', { headers: admin })
    expect(board.status).toBe(200)
    const stations = board.body.data.stations
    const mine = stations.find((s: { id: string }) => s.id === stationId)
    expect(mine).toBeTruthy()
    expect(mine.tickets.length).toBeGreaterThan(0)
    expect(Number.isFinite(mine.tickets[0].ageSec)).toBe(true)
  })

  it('station duplicate name → 409, remove while open tickets → 409 STATION_BUSY', async () => {
    const dup = await call('/api/kitchen-stations', {
      method: 'POST', headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({ outletId: resOutletId, name: stationName })
    })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('STATION_EXISTS')

    const busy = await call(`/api/kitchen-stations/${stationId}`, { method: 'DELETE', headers: admin })
    expect(busy.status).toBe(409)
    expect(busy.body.error.code).toBe('STATION_BUSY')
  })

  it('denies kitchen writes to staff lacking kitchen/kds permissions', async () => {
    const station403 = await call('/api/kitchen-stations', {
      method: 'POST', headers: { ...staff, ...jsonHeaders },
      body: JSON.stringify({ outletId: resOutletId, name: 'Nope', prepSlaMin: 5 })
    })
    expect(station403.status).toBe(403)

    const orderId = await makeOrder()
    const ticket403 = await call(`/api/kitchen/orders/${orderId}/tickets`, { method: 'POST', headers: staff })
    expect(ticket403.status).toBe(403)
  })

  it('lists tickets filtered by status', async () => {
    const orderId = await makeOrder()
    await generate(orderId)
    const list = await call(`/api/kitchen/tickets?status=NEW`, { headers: admin })
    expect(list.status).toBe(200)
    expect(list.body.data.items.length).toBeGreaterThan(0)
    for (const t of list.body.data.items) expect(t.status).toBe('NEW')
  })
})

afterAll(async () => {
  await call(`/api/kitchen-stations/${stationId}`, { method: 'DELETE', headers: admin }).catch(() => null)
})
