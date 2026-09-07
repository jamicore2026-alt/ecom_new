import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  fulfillments,
  invoices,
  orders,
  outlets as outletsTable,
  refunds,
  returnsTable,
  userOutlets,
  users
} from '../src/database/schema'

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

describe('commerce order-derived outlet isolation (invoices/fulfillments/analytics/overview)', () => {
  let merchantId: string
  let admin: Record<string, string> = {}
  let scopeB: Record<string, string> = {}
  let mainOutletId = ''
  let branchOutletId = ''
  let menuItemId = ''
  let mainOrderId = ''
  let branchOrderId = ''
  let onlineOrderId = ''
  let mainInvoiceId = ''
  let branchInvoiceId = ''
  let onlineInvoiceId = ''
  let mainFulfillmentId = ''
  let branchFulfillmentId = ''
  let onlineFulfillmentId = ''
  let scopeUserId = ''
  const cleanedOrderIds: string[] = []
  const cleanedInvoiceIds: string[] = []
  const cleanedFulfillmentIds: string[] = []

  const createFoodOrder = (headers: Record<string, string>, outletId: string) =>
    call('/api/food-orders', {
      method: 'POST',
      headers: { ...headers, ...jh, 'x-outlet-id': outletId },
      body: JSON.stringify({
        orderType: 'POS',
        outletId,
        items: [{ menuItemId: menuItemId, quantity: 1 }]
      })
    })

  beforeAll(async () => {
    admin = await loginAs('admin@acme.com')

    const [merchant] = await db.select().from(users).where(eq(users.email, 'admin@acme.com'))
    merchantId = merchant.merchantId

    const outs = await call('/api/outlets', { headers: admin })
    mainOutletId = outs.body.data.find((o: { code: string }) => o.code === 'MAIN').id

    // Branch outlet L + a reports-capable staff user scoped ONLY to L.
    const branchRes = await call('/api/outlets', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: 'Branch L', code: 'BRL', status: 'active' })
    })
    expect(branchRes.status).toBe(200)
    branchOutletId = branchRes.body.data.id

    const staff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({
        name: 'Outlet L Staff',
        email: 'outlet-commerce-l@acme.com',
        password: 'scope-pass-123456',
        role: 'staff',
        permissions: ['orders.read', 'orders.create', 'orders.update', 'orders.cancel', 'reports.read']
      })
    })
    expect(staff.status).toBe(200)
    scopeUserId = staff.body.data.id

    const assigned = await call(`/api/user-outlets/${scopeUserId}`, {
      method: 'PUT',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ outletIds: [branchOutletId] })
    })
    expect(assigned.status).toBe(200)

    scopeB = await loginAs('outlet-commerce-l@acme.com', 'scope-pass-123456')

    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find((i: { available: boolean; status: string }) => i.available && i.status === 'active').id

    // One POS order per branch on the shared orders table.
    const mainOrder = await createFoodOrder(admin, mainOutletId)
    expect(mainOrder.status).toBe(200)
    mainOrderId = mainOrder.body.data.id
    cleanedOrderIds.push(mainOrderId)

    const branchOrder = await createFoodOrder(scopeB, branchOutletId)
    expect(branchOrder.status).toBe(200)
    branchOrderId = branchOrder.body.data.id
    cleanedOrderIds.push(branchOrderId)

    // A seeded online (ecommerce) order — merchant-wide (orderType ecommerce,
    // outletId IS NULL), distinct from the POS food orders above.
    const [online] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          eq(orders.orderType, 'ecommerce'),
          eq(orders.status, 'pending'),
          eq(orders.paymentStatus, 'unpaid')
        )
      )
      .limit(1)
    expect(online).toBeDefined()
    onlineOrderId = online.id
  })

  it('scopes invoices by the order\'s outlet (list/get/create/getByOrder)', async () => {
    // admin creates invoices for MAIN and BRC orders; both succeed.
    const mainInv = await call('/api/invoices', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: mainOrderId })
    })
    expect(mainInv.status).toBe(200)
    mainInvoiceId = mainInv.body.data.id
    cleanedInvoiceIds.push(mainInvoiceId)

    const branchInv = await call('/api/invoices', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: branchOrderId })
    })
    expect(branchInv.status).toBe(200)
    branchInvoiceId = branchInv.body.data.id
    cleanedInvoiceIds.push(branchInvoiceId)

    // scopeB lists only its own branch invoices (+ merchant-wide online ones).
    const list = await call('/api/invoices', { headers: scopeB, })
    expect(list.status).toBe(200)
    const ids = (list.body.data.items ?? list.body.data).map((i: { id: string }) => i.id)
    expect(ids).toContain(branchInvoiceId)
    expect(ids).not.toContain(mainInvoiceId)

    // Row-level reads.
    const denied = await call(`/api/invoices/${mainInvoiceId}`, { headers: scopeB })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('OUTLET_SCOPE')

    const allowed = await call(`/api/invoices/${branchInvoiceId}`, { headers: scopeB })
    expect(allowed.status).toBe(200)
    expect(allowed.body.data.id).toBe(branchInvoiceId)

    // getByOrder is asserted against the order's outlet.
    const byOrder = await call(`/api/orders/${mainOrderId}/invoices`, { headers: scopeB })
    expect(byOrder.status).toBe(403)
    expect(byOrder.body.error.code).toBe('OUTLET_SCOPE')

    // Creates: merchant-wide (online) order is allowed, out-of-scope denied.
    const onlineInv = await call('/api/invoices', {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ orderId: onlineOrderId })
    })
    expect(onlineInv.status).toBe(200)
    onlineInvoiceId = onlineInv.body.data.id
    cleanedInvoiceIds.push(onlineInvoiceId)

    const deniedCreate = await call('/api/invoices', {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ orderId: mainOrderId })
    })
    expect(deniedCreate.status).toBe(403)
    expect(deniedCreate.body.error.code).toBe('OUTLET_SCOPE')
  })

  it('scopes fulfillments by the order\'s outlet (list/get/create/update)', async () => {
    const mainF = await call('/api/fulfillments', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: mainOrderId })
    })
    expect(mainF.status).toBe(200)
    mainFulfillmentId = mainF.body.data.id
    cleanedFulfillmentIds.push(mainFulfillmentId)

    const branchF = await call('/api/fulfillments', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ orderId: branchOrderId })
    })
    expect(branchF.status).toBe(200)
    branchFulfillmentId = branchF.body.data.id
    cleanedFulfillmentIds.push(branchFulfillmentId)

    const list = await call('/api/fulfillments', { headers: scopeB })
    expect(list.status).toBe(200)
    const ids = list.body.data.items.map((f: { id: string }) => f.id)
    expect(ids).toContain(branchFulfillmentId)
    expect(ids).not.toContain(mainFulfillmentId)

    const denied = await call(`/api/fulfillments/${mainFulfillmentId}`, { headers: scopeB })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('OUTLET_SCOPE')

    const allowed = await call(`/api/fulfillments/${branchFulfillmentId}`, { headers: scopeB })
    expect(allowed.status).toBe(200)
    expect(allowed.body.data.id).toBe(branchFulfillmentId)

    // Writes to an out-of-scope fulfillment are denied.
    const deniedUpdate = await call(`/api/fulfillments/${mainFulfillmentId}`, {
      method: 'PUT',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'shipped' })
    })
    expect(deniedUpdate.status).toBe(403)
    expect(deniedUpdate.body.error.code).toBe('OUTLET_SCOPE')

    const deniedCancel = await call(`/api/fulfillments/${mainFulfillmentId}/cancel`, {
      method: 'POST',
      headers: scopeB
    })
    expect(deniedCancel.status).toBe(403)

    // Create for a merchant-wide online order is allowed.
    const onlineF = await call('/api/fulfillments', {
      method: 'POST',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ orderId: onlineOrderId })
    })
    expect(onlineF.status).toBe(200)
    onlineFulfillmentId = onlineF.body.data.id
  })

  it('filters the overview dashboard to the caller\'s branch scope', async () => {
    const mainDetail = await call(`/api/orders/${mainOrderId}`, { headers: admin })
    const branchDetail = await call(`/api/orders/${branchOrderId}`, { headers: admin })
    const mainNumber = mainDetail.body.data.orderNumber
    const branchNumber = branchDetail.body.data.orderNumber

    const scopeOverview = await call('/api/overview', { headers: scopeB })
    expect(scopeOverview.status).toBe(200)
    const recent = scopeOverview.body.data.recentOrders.map((o: { orderNumber: string }) => o.orderNumber)
    expect(recent).toContain(branchNumber)
    expect(recent).not.toContain(mainNumber)

    const adminOverview = await call('/api/overview', { headers: admin })
    expect(adminOverview.status).toBe(200)
    const adminRecent = adminOverview.body.data.recentOrders.map((o: { orderNumber: string }) => o.orderNumber)
    expect(adminRecent).toContain(mainNumber)
    expect(adminRecent).toContain(branchNumber)
  })

  it('scopes analytics sales to the caller\'s branch scope', async () => {
    // Two PAID orders on an otherwise-empty historical day (400 days ago) so
    // the seeded data cannot contaminate the differential.
    const emptyDay = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
    const at = new Date(`${emptyDay}T12:00:00.000Z`)

    const insertPaid = async (outletId: string, total: number, marker: string) => {
      const [row] = await db
        .insert(orders)
        .values({
          merchantId,
          outletId,
          orderNumber: `#SCALE-${marker}-${Date.now()}`,
          status: 'CREATED',
          paymentStatus: 'paid',
          subtotal: total,
          total,
          createdAt: at
        })
        .returning()
      cleanedOrderIds.push(row.id)
      return row
    }

    await insertPaid(mainOutletId, 77, 'MAIN')
    await insertPaid(branchOutletId, 55, 'L')

    const q = `from=${emptyDay}&to=${emptyDay}&interval=day`
    const scopeSales = await call(`/api/analytics/sales?${q}`, { headers: scopeB })
    expect(scopeSales.status).toBe(200)
    expect(scopeSales.body.data.orders).toBe(1)
    expect(scopeSales.body.data.revenue).toBeCloseTo(55)

    const adminSales = await call(`/api/analytics/sales?${q}`, { headers: admin })
    expect(adminSales.status).toBe(200)
    expect(adminSales.body.data.orders).toBe(2)
    expect(adminSales.body.data.revenue).toBeCloseTo(132)
  })

  it('scopes return-approval and refund-retry by the order\'s outlet', async () => {
    // Pending return fixtures on each branch's POS order (orderItemId null so
    // approving never restocks).
    const mainRet = await db
      .insert(returnsTable)
      .values({ merchantId, orderId: mainOrderId, quantity: 1, amount: 0, status: 'pending' })
      .returning()
    const branchRet = await db
      .insert(returnsTable)
      .values({ merchantId, orderId: branchOrderId, quantity: 1, amount: 0, status: 'pending' })
      .returning()

    // Failed refund fixtures — retry asserts scope before touching the gateway.
    const mainRef = await db
      .insert(refunds)
      .values({ merchantId, orderId: mainOrderId, amount: 1, status: 'failed' })
      .returning({ id: refunds.id })
    const branchRef = await db
      .insert(refunds)
      .values({ merchantId, orderId: branchOrderId, amount: 1, status: 'failed' })
      .returning({ id: refunds.id })

    const deniedRet = await call(`/api/returns/${mainRet[0].id}`, {
      method: 'PATCH',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'approved' })
    })
    expect(deniedRet.status).toBe(403)
    expect(deniedRet.body.error.code).toBe('OUTLET_SCOPE')

    const allowedRet = await call(`/api/returns/${branchRet[0].id}`, {
      method: 'PATCH',
      headers: { ...scopeB, ...jh },
      body: JSON.stringify({ status: 'approved' })
    })
    expect(allowedRet.status).toBe(200)
    expect(allowedRet.body.data.status).toBe('approved')

    const deniedRef = await call(`/api/refunds/${mainRef[0].id}/retry`, {
      method: 'POST',
      headers: scopeB
    })
    expect(deniedRef.status).toBe(403)
    expect(deniedRef.body.error.code).toBe('OUTLET_SCOPE')

    const allowedRef = await call(`/api/refunds/${branchRef[0].id}/retry`, {
      method: 'POST',
      headers: scopeB
    })
    expect(allowedRef.status).toBe(200)
    expect(allowedRef.body.data.status).toBe('completed')
  })

  it('enforces roles.scope: MERCHANT/GLOBAL are merchant-wide, OUTLET needs an assignment', async () => {
    const stamp = Date.now()
    const merRole = await call('/api/roles', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: `ScMer-${stamp}`, permissions: ['orders.read'], scope: 'MERCHANT' })
    })
    expect(merRole.status).toBe(200)
    const merchantRoleId = merRole.body.data.id

    const outRole = await call('/api/roles', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: `ScOut-${stamp}`, permissions: ['orders.read'], scope: 'OUTLET' })
    })
    expect(outRole.status).toBe(200)
    const outletRoleId = outRole.body.data.id

    const mEmail = `scope-m-${stamp}@acme.com`
    const mStaff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: 'MERCHANT Scope', email: mEmail, password: 'scope-pass-123456', role: 'staff', roleId: merchantRoleId })
    })
    expect(mStaff.status).toBe(200)
    // no user_outlets assignment — MERCHANT scope must still be merchant-wide
    const mAuth = await loginAs(mEmail, 'scope-pass-123456')

    const oEmail = `scope-o-${stamp}@acme.com`
    const oStaff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...admin, ...jh },
      body: JSON.stringify({ name: 'OUTLET Scope', email: oEmail, password: 'scope-pass-123456', role: 'staff', roleId: outletRoleId })
    })
    expect(oStaff.status).toBe(200)
    const oAuth = await loginAs(oEmail, 'scope-pass-123456')

    const mList = await call('/api/orders', { headers: mAuth })
    expect(mList.status).toBe(200)
    expect(mList.body.data.items.some((o: { id: string }) => o.id === mainOrderId)).toBe(true)

    const oList = await call('/api/orders', { headers: oAuth })
    expect(oList.status).toBe(200)
    expect(oList.body.data.items.some((o: { id: string }) => o.id === mainOrderId)).toBe(false)
    expect(oList.body.data.items.some((o: { id: string }) => o.id === branchOrderId)).toBe(false)

    await db.delete(users).where(eq(users.email, oEmail))
    await db.delete(users).where(eq(users.email, mEmail))
  })

  afterAll(async () => {
    await db.delete(fulfillments).where(eq(fulfillments.id, mainFulfillmentId))
    await db.delete(fulfillments).where(eq(fulfillments.id, branchFulfillmentId))
    await db.delete(fulfillments).where(eq(fulfillments.id, onlineFulfillmentId))
    if (cleanedFulfillmentIds.length) {
      await db.delete(fulfillments).where(eq(fulfillments.id, cleanedFulfillmentIds[0]))
      for (const id of cleanedFulfillmentIds.slice(1)) {
        await db.delete(fulfillments).where(eq(fulfillments.id, id))
      }
    }
    if (cleanedInvoiceIds.length) {
      await db.delete(invoices).where(eq(invoices.id, cleanedInvoiceIds[0]))
      for (const id of cleanedInvoiceIds.slice(1)) {
        await db.delete(invoices).where(eq(invoices.id, id))
      }
    }
    if (cleanedOrderIds.length) {
      await db.delete(orders).where(eq(orders.id, cleanedOrderIds[0]))
      for (const id of cleanedOrderIds.slice(1)) {
        await db.delete(orders).where(eq(orders.id, id))
      }
    }
    if (scopeUserId) {
      await db.delete(userOutlets).where(eq(userOutlets.userId, scopeUserId))
      await db.delete(users).where(eq(users.id, scopeUserId))
    }
    await db.delete(outletsTable).where(eq(outletsTable.id, branchOutletId))
  })
})