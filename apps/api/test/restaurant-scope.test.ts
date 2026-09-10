import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { kitchenTickets, orders, outlets as outletsTable, tableSections, userOutlets, users } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
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

const listIds = (res: { status: number; body: { data: { id: string }[] } }) =>
  res.body.data.map((x) => x.id)

describe('restaurant-era outlet reads default-deny (tables + kitchen)', () => {
  let admin: Record<string, string> = {}
  let scopeB: Record<string, string> = {}
  let adminUserId = ''
  let scopedUserId = ''
  let mainOutletId = ''
  let branchOutletId = ''
  let menuItemId = ''
  let branchSectionId = ''
  let branchTableId = ''
  let mainSectionId = ''
  let mainTableId = ''
  let branchOrderId = ''
  let branchTicketId = ''
  const stamp = Date.now()
  const email = `rt-scope-${stamp}@jamicore.com`

  const createFoodOrder = (headers: Record<string, string>, outletId: string) =>
    call('/api/food-orders', {
      method: 'POST',
      headers: { ...headers, ...jh },
      body: JSON.stringify({ orderType: 'POS', outletId, items: [{ menuItemId: menuItemId, quantity: 1 }] })
    })

  beforeAll(async () => {
    admin = await loginAs('admin@jamicore.com')
    const [merchant] = await db.select().from(users).where(eq(users.email, 'admin@jamicore.com'))
    adminUserId = merchant.id

    const outs = await call('/api/outlets', { headers: admin })
    mainOutletId = outs.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    // Branch outlet BRB + staff scoped ONLY to BRB.
    const branchRes = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: 'Branch RT', code: 'BRT', status: 'active' })
    })
    expect(branchRes.status).toBe(200)
    branchOutletId = branchRes.body.data.id

    const staff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'RT Scope',
        email,
        password: 'scope-pass-123456',
        role: 'staff',
        permissions: ['tables.read', 'tables.manage', 'kitchen.read', 'kitchen.manage', 'kds.manage', 'orders.read', 'orders.create']
      })
    })
    expect(staff.status).toBe(200)
    scopedUserId = staff.body.data.id

    const assigned = await call(`/api/user-outlets/${scopedUserId}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletIds: [branchOutletId] })
    })
    expect(assigned.status).toBe(200)

    scopeB = await loginAs(email, 'scope-pass-123456')

    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id

    // Branch-owned section + table.
    const sec = await call('/api/table-sections', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletId: branchOutletId, name: `RT Floor ${stamp}`, sortOrder: 99 })
    })
    expect(sec.status).toBe(200)
    branchSectionId = sec.body.data.id

    const tbl = await call('/api/tables', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletId: branchOutletId, sectionId: branchSectionId, name: `RT${stamp}`, code: `RTX${stamp}`, seats: 4 })
    })
    expect(tbl.status).toBe(200)
    branchTableId = tbl.body.data.id

    // MAIN-owned section + table (controls for containment + 403s).
    const mainSec = await call('/api/table-sections', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletId: mainOutletId, name: `RT Main ${stamp}`, sortOrder: 99 })
    })
    expect(mainSec.status).toBe(200)
    mainSectionId = mainSec.body.data.id

    const mainTable = await call('/api/tables', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletId: mainOutletId, sectionId: mainSectionId, name: `RTM${stamp}`, code: `RTMX${stamp}`, seats: 4 })
    })
    expect(mainTable.status).toBe(200)
    mainTableId = mainTable.body.data.id

    // A branch food order + its KOT so the ticket-scoping assertions are non-trivial.
    const order = await createFoodOrder(admin, branchOutletId)
    expect(order.status).toBe(200)
    branchOrderId = order.body.data.id

    const kot = await call(`/api/kitchen/orders/${branchOrderId}/tickets`, {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ priority: 'NORMAL' })
    })
    expect(kot.status).toBe(200)
    branchTicketId = kot.body.data.items[0].id
  })

  it('filters table sections and tables to the caller\'s outlets', async () => {
    const sections = await call('/api/table-sections', { headers: scopeB })
    expect(sections.status).toBe(200)
    expect(listIds(sections)).toContain(branchSectionId)
    expect(listIds(sections)).not.toContain(mainSectionId)

    const tablesRes = await call('/api/tables', { headers: scopeB })
    expect(tablesRes.status).toBe(200)
    expect(listIds(tablesRes)).toContain(branchTableId)
    expect(listIds(tablesRes)).not.toContain(mainTableId)
  })

  it('denies row-level reads/writes on out-of-scope tables and sections', async () => {
    const deniedGet = await call(`/api/tables/${mainTableId}`, { headers: scopeB })
    expect(deniedGet.status).toBe(403)
    expect(deniedGet.body.error.code).toBe('OUTLET_SCOPE')

    const deniedUpdate = await call(`/api/table-sections/${mainSectionId}`, {
      method: 'PUT',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ name: `hacked ${stamp}` })
    })
    expect(deniedUpdate.status).toBe(403)
    expect(deniedUpdate.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('allows in-scope table lifecycle', async () => {
    const open = await call('/api/table-sessions', {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ tableId: branchTableId, guests: 2 })
    })
    expect(open.status).toBe(200)
    const sessionId = open.body.data.id

    const sessions = await call('/api/table-sessions', { headers: scopeB })
    expect(sessions.status).toBe(200)
    expect(listIds(sessions)).toContain(sessionId)

    await call(`/api/table-sessions/${sessionId}/close`, { method: 'POST', headers: scopeB })
  })

  it('scopes kitchen tickets to the caller\'s outlets', async () => {
    const tickets = await call('/api/kitchen/tickets', { headers: scopeB })
    expect(tickets.status).toBe(200)
    const items = tickets.body.data.items
    expect(items.map((t: { id: string }) => t.id)).toContain(branchTicketId)
    expect(items.every((t: { outletId: string }) => t.outletId === branchOutletId)).toBe(true)

    const denied = await call(`/api/kitchen/tickets/${branchTicketId}`, { headers: scopeB })
    expect(denied.status).toBe(200)
  })

  afterAll(async () => {
    await db.delete(kitchenTickets).where(eq(kitchenTickets.orderId, branchOrderId)).catch(() => null)
    await db.delete(orders).where(eq(orders.id, branchOrderId)).catch(() => null)
    await db.delete(outletsTable).where(eq(outletsTable.id, branchOutletId)).catch(() => null)
    await db.delete(tableSections).where(eq(tableSections.id, branchSectionId)).catch(() => null)
    await db.delete(tableSections).where(eq(tableSections.id, mainSectionId)).catch(() => null)
    await db.delete(users).where(eq(users.id, scopedUserId)).catch(() => null)
    await db.delete(userOutlets).where(eq(userOutlets.userId, scopedUserId)).catch(() => null)
    await db.delete(userOutlets).where(eq(userOutlets.userId, adminUserId)).catch(() => null)
  })
})