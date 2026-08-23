import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  customers,
  inventoryLogs,
  merchants,
  orders,
  paymentProviderConfigs,
  paymentTransactions,
  productVariants
} from '../src/database/schema'
import { StorefrontService } from '../src/modules/storefront/service'
import { verifyTamaraJwt } from '../src/payments/tamara'
import { decryptJson, encryptJson, isMaskedValue, maskSecret } from '../src/shared/crypto'
import { currencyDecimals, roundForCurrency } from '../src/shared/currency'

process.env.ENCRYPTION_KEY ??= 'payments-test-key'

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

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const signJwt = (payload: object, secret: string) => {
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payloadB64 = b64url(payload)
  const sig = createHmac('sha256', secret).update(`${header}.${payloadB64}`).digest('base64url')
  return `${header}.${payloadB64}.${sig}`
}

describe('payment primitives', () => {
  it('round-trips credentials through AES-256-GCM', () => {
    process.env.ENCRYPTION_KEY = 'payments-test-key'
    const secret = { apiToken: 'tok_123', publicKey: 'pk_456' }
    const ciphertext = encryptJson(secret)
    expect(ciphertext).not.toContain('tok_123')
    const decrypted = decryptJson(ciphertext)
    expect(decrypted).toEqual(secret)
    expect(decryptSafe(tampered(ciphertext))).toBeNull()
  })

  it('masks secrets and recognises masked values', () => {
    expect(maskSecret('sk_live_abcd1234')).toBe('••••1234')
    expect(maskSecret(null)).toBe('')
    expect(isMaskedValue(maskSecret('sk_live_abcd1234'))).toBe(true)
    expect(isMaskedValue('sk_live_abcd1234')).toBe(false)
  })

  it('rounds amounts per GCC three-decimal currencies', () => {
    expect(currencyDecimals('KWD')).toBe(3)
    expect(currencyDecimals('OMR')).toBe(3)
    expect(currencyDecimals('USD')).toBe(2)
    expect(roundForCurrency(10.1235, 'KWD')).toBe(10.124)
    expect(roundForCurrency(10.125, 'USD')).toBe(10.13)
  })

  it('verifies Tamara webhook JWTs with a timing-safe HS256 check', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const token = signJwt({ orderId: 'ord-1', exp: nowSec + 300 }, 'notify-secret')
    expect(verifyTamaraJwt(token, 'notify-secret')).toBe(true)
    expect(verifyTamaraJwt(token, 'wrong-secret')).toBe(false)
    expect(verifyTamaraJwt(undefined, 'notify-secret')).toBe(false)
    expect(verifyTamaraJwt('garbage.token', 'notify-secret')).toBe(false)

    const noneToken = `${b64url({ alg: 'none' })}.${b64url({ exp: nowSec + 300 })}.`
    expect(verifyTamaraJwt(noneToken, 'notify-secret')).toBe(false)

    const expired = signJwt({ exp: nowSec - 10 }, 'notify-secret')
    expect(verifyTamaraJwt(expired, 'notify-secret')).toBe(false)
  })
})

describe('storefront payments integration', () => {
  let merchantId: string
  let productId: string
  let variantId: string

  const codCheckout = async (email: string) =>
    call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId, variantId, quantity: 1 }],
        email,
        shippingAddress: {
          name: 'Pay Test',
          line1: '9 Test Ln',
          city: 'Kuwait City',
          state: 'KW',
          postalCode: '10000',
          country: 'KW'
        },
        paymentMethod: 'cod'
      })
    )

  beforeAll(async () => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, 'acme-store'))
    merchantId = merchant.id

    await db.insert(paymentProviderConfigs).values({
      merchantId,
      provider: 'tamara',
      enabled: true,
      mode: 'test',
      country: 'SA',
      credentials: encryptJson({
        publicKey: 'pk-test',
        apiToken: 'tok-test',
        notificationToken: 'notify-test'
      })
    })

    const list = await call('/api/store/acme-store/products?limit=100')
    const product = list.body.data.items.find((i: any) => i.stock >= 20)
    productId = product.id
    const detail = await call(`/api/store/acme-store/products/${product.slug}`)
    variantId = detail.body.data.variants[0].id
  })

  it('exposes enabled providers on the public store payload', async () => {
    const res = await call('/api/store/acme-store/store')
    expect(res.status).toBe(200)
    const providers = res.body.data.payments.providers
    expect(providers).toContainEqual({ id: 'tamara', label: 'Tamara — Pay in 4' })
  })

  it('redirects online provider methods away from the plain checkout', async () => {
    const res = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId, variantId, quantity: 1 }],
        email: 'provider@example.com',
        shippingAddress: { name: 'P', line1: '1', city: 'C', state: 'S', postalCode: '1', country: 'SA' },
        paymentMethod: 'tamara'
      })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYMENT_REQUIRES_REDIRECT')
  })

  it('rejects unavailable payment methods', async () => {
    const res = await call(
      '/api/store/acme-store/checkout',
      json({
        items: [{ productId, variantId, quantity: 1 }],
        email: 'provider@example.com',
        shippingAddress: { name: 'P', line1: '1', city: 'C', state: 'S', postalCode: '1', country: 'SA' },
        paymentMethod: 'myfatoorah'
      })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE')
  })

  it('rejects Tamara webhooks without a valid signed token', async () => {
    const res = await call('/api/webhooks/tamara/acme-store', json({ orderId: 'nope' }))
    expect(res.status).toBe(400)
  })

  it('marks an order paid when the provider confirms payment', async () => {
    const placed = await codCheckout('paytest@example.com')
    expect(placed.status).toBe(200)
    const orderNumber = placed.body.data.orderNumber

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.orderNumber, orderNumber)))
    expect(order.paymentStatus).toBe('unpaid')

    await db.insert(paymentTransactions).values({
      merchantId,
      orderId: order.id,
      provider: 'myfatoorah',
      providerRef: 'mf-ref-paytest',
      status: 'pending',
      amount: order.total,
      currency: order.currency
    })

    await StorefrontService.applyPaymentResult(merchantId, 'myfatoorah', {
      providerRef: 'mf-ref-paytest',
      status: 'paid',
      eventId: 'evt-paytest-1',
      raw: { source: 'test' }
    })

    const [updated] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updated.paymentStatus).toBe('paid')
    expect(updated.expiresAt).toBeNull()

    const [txn] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.providerRef, 'mf-ref-paytest'))
    expect(txn.status).toBe('paid')

    // A second confirmation must not double-apply anything harmful
    await StorefrontService.applyPaymentResult(merchantId, 'myfatoorah', {
      providerRef: 'mf-ref-paytest',
      status: 'paid',
      eventId: 'evt-paytest-2'
    })
    const [again] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(again.paymentStatus).toBe('paid')
  })

  it('expires stale unpaid orders and restores their stock', async () => {
    const [variantBefore] = await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    const placed = await codCheckout('sweep@example.com')
    expect(placed.status).toBe(200)
    const orderNumber = placed.body.data.orderNumber

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.orderNumber, orderNumber)))

    const expired = new Date(Date.now() - 60 * 60 * 1000)
    await db.update(orders).set({ expiresAt: expired }).where(eq(orders.id, order.id))

    const swept = await StorefrontService.sweepExpiredOrders()
    expect(swept).toBeGreaterThanOrEqual(1)

    const [after] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(after.status).toBe('cancelled')
    expect(after.paymentStatus).toBe('failed')

    const [variantAfter] = await db.select().from(productVariants).where(eq(productVariants.id, variantId))
    expect(variantAfter.inventory).toBe(variantBefore.inventory)

    const logs = await db
      .select()
      .from(inventoryLogs)
      .where(and(eq(inventoryLogs.reference, orderNumber), eq(inventoryLogs.reason, 'cancel')))
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })

  afterAll(async () => {
    await db
      .delete(paymentProviderConfigs)
      .where(and(eq(paymentProviderConfigs.merchantId, merchantId), eq(paymentProviderConfigs.provider, 'tamara')))
    await db
      .delete(inventoryLogs)
      .where(and(eq(inventoryLogs.merchantId, merchantId), like(inventoryLogs.reference, '#W%')))
    // payment_transactions cascade with their orders
    await db.delete(orders).where(and(eq(orders.merchantId, merchantId), like(orders.orderNumber, '#W%')))
    await db
      .delete(customers)
      .where(
        and(
          eq(customers.merchantId, merchantId),
          inArray(customers.email, ['paytest@example.com', 'sweep@example.com'])
        )
      )
  })
})

// -- helpers ----------------------------------------------------------------

function decryptSafe(ciphertext: string): Record<string, string> | null {
  try {
    return decryptJson(ciphertext)
  } catch {
    return null
  }
}

function tampered(ciphertext: string): string {
  const [iv, tag, data] = ciphertext.split(':')
  const flipped = Buffer.from(data, 'base64')
  flipped[0] ^= 0xff
  return `${iv}:${tag}:${flipped.toString('base64')}`
}
