import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { merchants, visits } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

function today() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

describe('storefront funnel events', () => {
  let merchantId = ''

  beforeAll(async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id
    await db
      .delete(visits)
      .where(and(eq(visits.merchantId, merchantId), eq(visits.date, today()), eq(visits.channel, 'direct')))
  })

  afterAll(async () => {
    await db
      .delete(visits)
      .where(and(eq(visits.merchantId, merchantId), eq(visits.date, today()), eq(visits.channel, 'direct')))
  })

  const rowFor = async () => {
    const [row] = await db
      .select()
      .from(visits)
      .where(and(eq(visits.merchantId, merchantId), eq(visits.date, today()), eq(visits.channel, 'direct')))
    return row
  }

  it('rejects unknown event types', async () => {
    const res = await call('/api/store/acme-store/events', json({ type: 'purchase' }))
    expect(res.status).toBe(400)
  })

  it('counts views, cart adds and checkout starts into the daily funnel', async () => {
    expect(await rowFor()).toBeUndefined()

    for (let i = 0; i < 3; i++) {
      const res = await call('/api/store/acme-store/events', json({ type: 'view' }))
      expect(res.status).toBe(200)
    }
    await call('/api/store/acme-store/events', json({ type: 'cart_add' }))
    await call('/api/store/acme-store/events', json({ type: 'checkout_start' }))

    const row = await rowFor()
    expect(row).toBeDefined()
    expect(row!.views).toBe(3)
    expect(row!.cartAdds).toBe(1)
    expect(row!.checkouts).toBe(1)
  })

  it('separates channels', async () => {
    const res = await call(
      '/api/store/acme-store/events',
      json({ type: 'view', channel: 'newsletter' })
    )
    expect(res.status).toBe(200)

    const [row] = await db
      .select()
      .from(visits)
      .where(
        and(eq(visits.merchantId, merchantId), eq(visits.date, today()), eq(visits.channel, 'newsletter'))
      )
    expect(row.views).toBe(1)

    await db.delete(visits).where(eq(visits.id, row.id))
  })
})
