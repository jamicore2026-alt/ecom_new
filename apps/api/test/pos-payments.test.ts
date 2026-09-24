import { describe, expect, it } from 'bun:test'
import { and, asc, eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { orders, paymentTransactions } from '../src/database/schema'

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

const round2 = (n: number) => Math.round(n * 100) / 100

describe('POS split payments, tips and discounts', () => {
  let admin: Record<string, string>
  let outletId = ''
  let menuItemId = ''

  it('loads admin + outlet + a menu item', async () => {
    admin = await loginAs('admin@jamicore.com')
    const outlets = await call('/api/outlets', { headers: admin })
    outletId = outlets.body.data.find((o: { code: string }) => o.code === 'MAIN').id
    const menu = await call('/api/menu', { headers: admin })
    menuItemId = menu.body.data.items.find(
      (i: { available: boolean; status: string }) => i.available && i.status === 'active'
    ).id
  })

  const createPosOrder = async () => {
    const res = await call('/api/food-orders', {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify({
        orderType: 'POS',
        outletId,
        items: [{ menuItemId, quantity: 2 }]
      })
    })
    expect(res.status).toBe(200)
    return res.body.data as { id: string; total: number }
  }

  const pay = (id: string, body: Record<string, unknown>) =>
    call(`/api/food-orders/${id}/pay`, {
      method: 'POST',
      headers: { ...admin, ...jsonHeaders },
      body: JSON.stringify(body)
    })

  const dbOrder = async (id: string) => {
    const [row] = await db.select().from(orders).where(eq(orders.id, id))
    return row
  }

  const dbTxns = (id: string, merchantId: string) =>
    db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.orderId, id),
          eq(paymentTransactions.merchantId, merchantId),
          eq(paymentTransactions.status, 'paid')
        )
      )
      .orderBy(asc(paymentTransactions.createdAt))

  it('records a partial pay as partially_paid', async () => {
    const order = await createPosOrder()
    expect(order.total).toBeGreaterThan(1)
    const partial = round2(order.total - 1)

    const res = await pay(order.id, { paymentMethod: 'card', amount: partial })
    expect(res.status).toBe(200)
    expect(res.body.data.paymentStatus).toBe('partially_paid')

    const row = await dbOrder(order.id)
    expect(row.paymentStatus).toBe('partially_paid')
    const txns = await dbTxns(order.id, row.merchantId)
    expect(txns).toHaveLength(1)
    expect(Number(txns[0].amount)).toBeCloseTo(partial)
  })

  it('completes with a second pay defaulting to the remainder, then replays ALREADY_PAID', async () => {
    const order = await createPosOrder()
    const partial = round2(order.total - 1)
    await pay(order.id, { paymentMethod: 'card', amount: partial })

    // No amount → pays the remaining balance.
    const done = await pay(order.id, { paymentMethod: 'card' })
    expect(done.status).toBe(200)
    expect(done.body.data.paymentStatus).toBe('paid')

    const again = await pay(order.id, { paymentMethod: 'card', amount: 1 })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('ALREADY_PAID')
  })

  it('accumulates tips across split payments', async () => {
    const order = await createPosOrder()
    const partial = round2(order.total - 1)

    const first = await pay(order.id, { paymentMethod: 'card', amount: partial, tip: 1.5 })
    expect(first.status).toBe(200)
    expect(first.body.data.paymentStatus).toBe('partially_paid')
    expect(Number(first.body.data.tipTotal)).toBeCloseTo(1.5)

    // Remainder defaults to balance including the new tip.
    const second = await pay(order.id, { paymentMethod: 'cash', tip: 2 })
    expect(second.status).toBe(200)
    expect(second.body.data.paymentStatus).toBe('paid')
    expect(Number(second.body.data.tipTotal)).toBeCloseTo(3.5)

    const row = await dbOrder(order.id)
    expect(Number(row.tipTotal)).toBeCloseTo(3.5)
  })

  it('accumulates discounts with a reason on the transaction', async () => {
    const order = await createPosOrder()
    const owingAfter = round2(order.total - 3)
    expect(owingAfter).toBeGreaterThan(1)

    const res = await pay(order.id, {
      paymentMethod: 'cash',
      amount: round2(owingAfter - 1),
      discountAmount: 3,
      discountReason: 'Staff meal'
    })
    expect(res.status).toBe(200)
    expect(res.body.data.paymentStatus).toBe('partially_paid')
    expect(Number(res.body.data.discountTotal)).toBeCloseTo(3)

    const row = await dbOrder(order.id)
    expect(Number(row.discountTotal)).toBeCloseTo(3)
    const txns = await dbTxns(order.id, row.merchantId)
    expect(txns.length).toBeGreaterThan(0)
    const raw = txns[0].raw as Record<string, unknown>
    expect(Number(raw.discountAmount)).toBeCloseTo(3)
    expect(raw.discountReason).toBe('Staff meal')
    // Discounted remainder still completes the order.
    const done = await pay(order.id, { paymentMethod: 'cash' })
    expect(done.body.data.paymentStatus).toBe('paid')
  })

  it('rejects non-cash overpay but allows cash overpay with change', async () => {
    const order = await createPosOrder()

    const over = await pay(order.id, { paymentMethod: 'card', amount: round2(order.total + 5) })
    expect(over.status).toBe(400)
    expect(over.body.error.code).toBe('OVERPAY_NOT_ALLOWED')

    const cash = await pay(order.id, {
      paymentMethod: 'cash',
      cashReceived: round2(order.total + 5)
    })
    expect(cash.status).toBe(200)
    expect(cash.body.data.paymentStatus).toBe('paid')

    const row = await dbOrder(order.id)
    const txns = await dbTxns(order.id, row.merchantId)
    const raw = txns[txns.length - 1].raw as Record<string, unknown>
    expect(Number(raw.change)).toBeCloseTo(5)
  })

  it('rejects non-positive amounts and negative tips/discounts', async () => {
    const order = await createPosOrder()

    expect((await pay(order.id, { paymentMethod: 'card', amount: 0 })).status).toBe(400)
    expect((await pay(order.id, { paymentMethod: 'card', amount: -2 })).status).toBe(400)
    expect((await pay(order.id, { paymentMethod: 'card', tip: -1 })).status).toBe(400)
    expect((await pay(order.id, { paymentMethod: 'card', discountAmount: -1 })).status).toBe(400)
  })
})
