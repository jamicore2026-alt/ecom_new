import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  affiliates,
  customers,
  customerSegments,
  customerTags,
  merchants,
  orders,
  referrals
} from '../src/database/schema'
import { CampaignsService } from '../src/modules/campaigns/service'
import { AffiliatesService } from '../src/modules/affiliates/service'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
})

const tag = () => createId().slice(0, 8)

describe('Growth — campaign audiences + affiliate attribution/payout', () => {
  let adminToken = ''
  let merchantId = ''
  const customerIds: string[] = []
  const orderIds: string[] = []
  let firstOrderId = ''
  const segmentIds: string[] = []
  const affiliateIds: string[] = []
  const referralIds: string[] = []
  const suffix = tag()

  const mkCustomer = async (email: string, tags: string[] = []) => {
    const [row] = await db
      .insert(customers)
      .values({ merchantId, email, tags })
      .returning()
    customerIds.push(row.id)
    return row
  }

  const mkOrder = async (n: string, customerId?: string | null) => {
    const [row] = await db
      .insert(orders)
      .values({
        merchantId,
        customerId: customerId ?? null,
        orderNumber: `#GROW-${suffix}-${n}`,
        status: 'pending',
        paymentStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        subtotal: 0,
        shippingTotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        total: 0,
        currency: 'USD'
      })
      .returning()
    orderIds.push(row.id)
    return row
  }

  beforeAll(async () => {
    const login = await call('/api/auth/login', json({ email: 'admin@jamicore.com', password: 'password123' }))
    adminToken = login.body.data.accessToken
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'jamicore-store'))
    merchantId = merchant.id

    await mkCustomer(`growth-all-${suffix}@test.local`)
    await mkCustomer(`growth-vip-${suffix}@test.local`, [`vip-${suffix}`])
    const tagged = await mkCustomer(`growth-viptag-${suffix}@test.local`)
    await db.insert(customerTags).values({ merchantId, customerId: tagged.id, tag: `vip-${suffix}` })

    const [segment] = await db
      .insert(customerSegments)
      .values({ merchantId, name: `Growth Seg ${suffix}`, definition: {}, customerCount: 0 })
      .returning()
    segmentIds.push(segment.id)
  })

  /* ------------------------- audience resolution ------------------------- */

  it('resolves {type:all} to every customer email', async () => {
    const emails = await CampaignsService.resolveAudience(db, merchantId, { type: 'all' })
    expect(emails).toContain(`growth-all-${suffix}@test.local`)
    expect(emails).toContain(`growth-vip-${suffix}@test.local`)
    expect(new Set(emails).size).toBe(emails.length)
  })

  it('resolves a missing/empty audience as all (back-compat)', async () => {
    const emails = await CampaignsService.resolveAudience(db, merchantId, {})
    expect(emails).toContain(`growth-all-${suffix}@test.local`)
  })

  it('resolves {type:segment} via live segment membership', async () => {
    const emails = await CampaignsService.resolveAudience(db, merchantId, {
      type: 'segment',
      segmentId: segmentIds[0]
    })
    // Empty definition matches every customer of the merchant.
    expect(emails).toContain(`growth-all-${suffix}@test.local`)
    expect(new Set(emails).size).toBe(emails.length)
  })

  it('rejects a segment audience with an unknown segment', async () => {
    await expect(
      CampaignsService.resolveAudience(db, merchantId, { type: 'segment', segmentId: 'nope' })
    ).rejects.toMatchObject({ code: 'SEGMENT_NOT_FOUND' })
  })

  it('resolves {type:tag} from both the tags column and customer_tags', async () => {
    const emails = await CampaignsService.resolveAudience(db, merchantId, {
      type: 'tag',
      tag: `vip-${suffix}`
    })
    expect(emails).toContain(`growth-vip-${suffix}@test.local`)
    expect(emails).toContain(`growth-viptag-${suffix}@test.local`)
    expect(emails).not.toContain(`growth-all-${suffix}@test.local`)
  })

  it('resolves {type:list} with dedupe + validation', async () => {
    const emails = await CampaignsService.resolveAudience(db, merchantId, {
      type: 'list',
      emails: ['A@Test.Local', 'a@test.local', 'not-an-email', '  B@test.local ', '', 42 as never]
    })
    expect(emails).toEqual(['a@test.local', 'b@test.local'])
  })

  it('rejects an unknown audience type', async () => {
    await expect(
      CampaignsService.resolveAudience(db, merchantId, { type: 'carrier-pigeon' })
    ).rejects.toMatchObject({ code: 'INVALID_AUDIENCE' })
  })

  /* --------------------------- attribution math --------------------------- */

  it('attributes an order: subtotal * rate/100, pending, converted', async () => {
    const code = `GROW${suffix}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
    const created = await AffiliatesService.create(db, merchantId, {
      name: 'Growth Partner',
      email: `growth-aff-${suffix}@test.local`,
      referralCode: code,
      commissionRate: 10
    })
    affiliateIds.push(created.data.id)

    const orderId = (await mkOrder('1', customerIds[0])).id
    firstOrderId = orderId
    const res = await AffiliatesService.attributeOrder(db, merchantId, {
      orderId,
      customerId: customerIds[0],
      subtotal: 200,
      referralCode: code.toLowerCase() // codes are case-insensitive
    })
    expect(Number(res.data!.commissionAmount)).toBeCloseTo(20)
    expect(res.data!.conversionStatus).toBe('converted')
    expect(res.data!.commissionStatus).toBe('pending')
    expect(res.data!.source).toBe('code')
    referralIds.push(res.data!.id)

    // Idempotent on retry for the same order.
    const again = await AffiliatesService.attributeOrder(db, merchantId, {
      orderId,
      customerId: customerIds[0],
      subtotal: 200,
      referralCode: code
    })
    expect(again.data!.id).toBe(res.data!.id)
  })

  it('keeps the click source on conversion after trackClick', async () => {
    const code = `CLICK${suffix}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
    const created = await AffiliatesService.create(db, merchantId, {
      name: 'Click Partner',
      email: `click-aff-${suffix}@test.local`,
      referralCode: code,
      commissionRate: 15
    })
    affiliateIds.push(created.data.id)

    const click = await AffiliatesService.trackClick(db, {
      code,
      customerId: customerIds[1],
      merchantId
    })
    expect(click.data.conversionStatus).toBe('clicked')
    expect(click.data.commissionStatus).toBe('pending')
    referralIds.push(click.data.id)

    const converted = await AffiliatesService.attributeOrder(db, merchantId, {
      orderId: (await mkOrder('2', customerIds[1])).id,
      customerId: customerIds[1],
      subtotal: 100,
      referralCode: code
    })
    expect(Number(converted.data!.commissionAmount)).toBeCloseTo(15)
    expect(converted.data!.source).toBe('click')
    referralIds.push(converted.data!.id)
  })

  it('ignores unknown/inactive codes silently (hook no-op)', async () => {
    const res = await AffiliatesService.attributeOrder(db, merchantId, {
      orderId: `order-${suffix}-noop`,
      subtotal: 50,
      referralCode: 'NOPE-NOT-REAL'
    })
    expect(res.data!).toBeNull()
  })

  it('exposes public click tracking without auth', async () => {
    const code = `PUB${suffix}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
    const created = await AffiliatesService.create(db, merchantId, {
      name: 'Public Partner',
      email: `pub-aff-${suffix}@test.local`,
      referralCode: code,
      commissionRate: 5
    })
    affiliateIds.push(created.data.id)

    const res = await call('/api/affiliates/track', json({ code }))
    expect(res.status).toBe(200)
    expect(res.body.data.conversionStatus).toBe('clicked')
    referralIds.push(res.body.data.id)
  })

  /* --------------------- payout transitions + threshold --------------------- */

  it('approves pending→approved and runs a payout approved→paid', async () => {
    const pendingId = referralIds[0]
    const approved = await AffiliatesService.approveReferral(db, merchantId, pendingId)
    expect(approved.data.commissionStatus).toBe('approved')

    await expect(
      AffiliatesService.approveReferral(db, merchantId, pendingId)
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })

    const run = await AffiliatesService.runPayout(db, merchantId, {})
    const mine = run.data.payouts.find((p: any) => p.affiliateId === affiliateIds[0])
    expect(mine).toBeDefined()
    expect(mine!.total).toBeCloseTo(20)

    const [row] = await db.select().from(referrals).where(eq(referrals.id, pendingId))
    expect(row.commissionStatus).toBe('paid')
  })

  it('honours the minPayout threshold guard', async () => {
    // affiliateIds[1] (click partner) has a pending 15 commission — approve it.
    const clickConverted = referralIds[2]
    await AffiliatesService.approveReferral(db, merchantId, clickConverted)

    const run = await AffiliatesService.runPayout(db, merchantId, {
      affiliateIds: [affiliateIds[1]],
      minPayout: 1000
    })
    expect(run.data.payouts).toHaveLength(0)
    expect(run.data.skipped.some((s: any) => s.affiliateId === affiliateIds[1])).toBe(true)

    const [row] = await db.select().from(referrals).where(eq(referrals.id, clickConverted))
    expect(row.commissionStatus).toBe('approved')

    // Without the guard it pays out.
    const paid = await AffiliatesService.runPayout(db, merchantId, {
      affiliateIds: [affiliateIds[1]]
    })
    expect(paid.data.totalAmount).toBeCloseTo(15)
    expect(paid.data.totalCount).toBe(1)
  })

  it('cancels pending commissions with a reason, and refuses paid ones', async () => {
    const clickRow = referralIds[1] // still pending 'clicked' row
    const cancelled = await call(
      `/api/affiliates/referrals/${clickRow}/cancel`,
      json({ reason: 'fraud' }, adminToken)
    )
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.commissionStatus).toBe('cancelled')

    const paidId = referralIds[0] // paid in the earlier payout test
    const res = await call(`/api/affiliates/referrals/${paidId}/cancel`, json({}, adminToken))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_TRANSITION')
  })

  it('approves via the HTTP endpoint', async () => {
    const fresh = await AffiliatesService.attributeOrder(db, merchantId, {
      orderId: (await mkOrder('http')).id,
      subtotal: 80,
      referralCode: (await db.select().from(affiliates).where(eq(affiliates.id, affiliateIds[0])))[0].referralCode
    })
    referralIds.push(fresh.data!.id)
    const res = await call(`/api/affiliates/referrals/${fresh.data!.id}/approve`, json({}, adminToken))
    expect(res.status).toBe(200)
    expect(res.body.data.commissionStatus).toBe('approved')
  })

  /* --------------------------- refund reversal --------------------------- */

  it('cancels pending/approved commissions on refund, keeps paid ones', async () => {
    const refundOrderId = (await mkOrder('refund')).id
    const conv = await AffiliatesService.attributeOrder(db, merchantId, {
      orderId: refundOrderId,
      subtotal: 120,
      referralCode: (await db.select().from(affiliates).where(eq(affiliates.id, affiliateIds[0])))[0].referralCode
    })
    referralIds.push(conv.data!.id)

    const reversed = await AffiliatesService.reverseForRefund(db, merchantId, refundOrderId)
    expect(reversed.data.reversed).toBe(1)
    const [row] = await db.select().from(referrals).where(eq(referrals.id, conv.data!.id))
    expect(row.commissionStatus).toBe('cancelled')

    // Paid commissions survive reversal for manual settlement.
    const kept = await AffiliatesService.reverseForRefund(db, merchantId, firstOrderId)
    expect(kept.data.reversed).toBe(0)
  })

  afterAll(async () => {
    const safe = (fn: () => Promise<unknown>) => fn().catch(() => undefined)
    for (const id of referralIds) {
      await safe(() => db.delete(referrals).where(eq(referrals.id, id)))
    }
    for (const id of affiliateIds) {
      await safe(() => db.delete(affiliates).where(eq(affiliates.id, id)))
    }
    for (const id of segmentIds) {
      await safe(() => db.delete(customerSegments).where(eq(customerSegments.id, id)))
    }
    for (const id of customerIds) {
      await safe(() => db.delete(customerTags).where(and(eq(customerTags.merchantId, merchantId), eq(customerTags.customerId, id))))
      await safe(() => db.delete(customers).where(eq(customers.id, id)))
    }
    for (const id of orderIds) {
      await safe(() => db.delete(orders).where(eq(orders.id, id)))
    }
  })
})
