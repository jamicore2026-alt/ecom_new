import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import {
  invoiceSettings,
  invoices,
  merchants,
  orderItems,
  orders,
  outlets as outletsTable,
  userOutlets,
  users
} from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const contentType = res.headers.get('content-type') ?? ''
  const body = contentType.includes('json') ? await res.json() : await res.arrayBuffer()
  return { status: res.status, headers: res.headers, body }
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const loginAs = async (email: string, password = 'password123') => {
  const res = await call('/api/auth/login', json({ email, password }))
  return { authorization: `Bearer ${res.body.data.accessToken}` }
}

const stamp = Date.now()
let headers: Record<string, string> = {}
let merchantId = ''
let orderId = ''
let invoiceId = ''
let creditId = ''
let scopedHeaders: Record<string, string> = {}
let scopedOrderId = ''
let foreignInvoiceId = ''
let branchXId = ''
let branchYId = ''
let scopedUserId = ''
let staffEmail = ''
const cleanedOutlets: string[] = []

describe('Invoice PDF download + invoice customization', () => {
  beforeAll(async () => {
    headers = await loginAs('admin@jamicore.com')
    const [merchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.slug, 'jamicore-store'))
    merchantId = merchant.id

    const [order] = await db
      .insert(orders)
      .values({
        merchantId,
        orderNumber: `PDF-${stamp}`,
        status: 'paid',
        paymentStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        subtotal: 250,
        shippingTotal: 10,
        discountTotal: 20,
        taxTotal: 18,
        total: 258,
        currency: 'USD',
        orderType: 'ecommerce',
        billingAddress: {
          name: 'Test Buyer',
          line1: '1 Test Street',
          city: 'Riyadh',
          state: 'Ar Riyad',
          postalCode: '11564',
          country: 'SA',
          phone: '+966500000000'
        },
        shippingAddress: {
          name: 'Test Buyer',
          line1: '1 Test Street',
          city: 'Riyadh',
          postalCode: '11564',
          country: 'SA'
        },
        paymentMethod: 'card'
      })
      .returning()
    orderId = order.id

    await db.insert(orderItems).values([
      { orderId, name: 'Wireless Headphones', sku: 'WH-1000', price: 150, quantity: 1, total: 150 },
      { orderId, name: 'USB Cable', sku: 'UC-2M', price: 12.5, quantity: 2, total: 25 }
    ])

    // Branch-scoped denial fixture: two new outlets, a staff user scoped only
    // to X, and an outlet-Y order/invoice the staff must not be able to see.
    const jh = { 'content-type': 'application/json' }
    const makeOutlet = async (code: string) => {
      const res = await call('/api/outlets', {
        method: 'POST',
        headers: { ...headers, ...jh },
        body: JSON.stringify({ name: `Inv PDF ${code}`, code, status: 'active' })
      })
      expect(res.status).toBe(200)
      cleanedOutlets.push(res.body.data.id)
      return res.body.data.id
    }
    branchXId = await makeOutlet(`INVX${stamp.toString().slice(-4)}`)
    branchYId = await makeOutlet(`INVY${stamp.toString().slice(-4)}`)

    staffEmail = `invpdf-${stamp}@jamicore.com`
    const staff = await call('/api/settings/staff', {
      method: 'POST',
      headers: { ...headers, ...jh },
      body: JSON.stringify({
        name: 'Invoice PDF Scoped Staff',
        email: staffEmail,
        password: 'scope-pass-123456',
        role: 'staff',
        permissions: ['orders.read', 'reports.read']
      })
    })
    expect(staff.status).toBe(200)
    scopedUserId = staff.body.data.id
    const assigned = await call(`/api/user-outlets/${scopedUserId}`, {
      method: 'PUT',
      headers: { ...headers, ...jh },
      body: JSON.stringify({ outletIds: [branchXId] })
    })
    expect(assigned.status).toBe(200)
    scopedHeaders = await loginAs(staffEmail, 'scope-pass-123456')

    // Outlet-scoped order + invoice owned by branch Y (outside staff's scope).
    const [scopedOrder] = await db
      .insert(orders)
      .values({
        merchantId,
        orderNumber: `PDFY-${stamp}`,
        status: 'paid',
        paymentStatus: 'paid',
        subtotal: 30,
        total: 30,
        currency: 'USD',
        orderType: 'ecommerce',
        outletId: branchYId,
        billingAddress: { name: 'Branch Y Buyer' }
      })
      .returning()
    scopedOrderId = scopedOrder.id
    const scopedInv = await call('/api/invoices', {
      method: 'POST',
      headers: { ...headers, ...jh },
      body: JSON.stringify({ orderId: scopedOrderId })
    })
    expect(scopedInv.status).toBe(200)
    foreignInvoiceId = scopedInv.body.data.id
  })

  afterAll(async () => {
    await db.delete(invoices).where(eq(invoices.orderId, orderId))
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId))
    await db.delete(orders).where(eq(orders.id, orderId))
    await db.delete(invoices).where(eq(invoices.orderId, scopedOrderId))
    await db.delete(orderItems).where(eq(orderItems.orderId, scopedOrderId))
    await db.delete(orders).where(eq(orders.id, scopedOrderId))
    await db.delete(invoiceSettings).where(eq(invoiceSettings.merchantId, merchantId))
    if (scopedUserId) {
      await db.delete(userOutlets).where(eq(userOutlets.userId, scopedUserId))
      await db.delete(users).where(eq(users.id, scopedUserId))
    }
    for (const id of cleanedOutlets) {
      await db.delete(outletsTable).where(eq(outletsTable.id, id))
    }
  })

  it('returns default invoice settings for a merchant without custom rows', async () => {
    const res = await call('/api/settings/invoice', { headers })
    expect(res.status).toBe(200)
    expect(res.body.data.layout).toBe('standard')
    expect(Array.isArray(res.body.data.displayFields.columns)).toBe(true)
    expect(res.body.data.prefix).toBeTruthy()
    expect(res.body.data.businessName).toBeTruthy()
  })

  it('updates invoice customization and round-trips the values', async () => {
    const put = await call('/api/settings/invoice', {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        prefix: 'ACME',
        businessName: 'ACME Trading Co',
        taxLabel: 'VAT',
        taxNumber: 'VAT-310123456',
        headerNote: 'Thank you for your business.',
        footerNote: 'Payments due within 30 days.',
        address: { name: 'ACME Trading Co', line1: 'King Fahd Rd', city: 'Jeddah', country: 'SA' },
        phone: '+966512345678',
        email: 'billing@acme.example',
        displayFields: { columns: ['item', 'sku', 'qty', 'price', 'total'], showDiscount: true, showTax: true },
        layout: 'compact'
      })
    })
    expect(put.status).toBe(200)
    expect(put.body.data.prefix).toBe('ACME')
    expect(put.body.data.businessName).toBe('ACME Trading Co')
    expect(put.body.data.layout).toBe('compact')
    expect(put.body.data.taxLabel).toBe('VAT')
    expect(put.body.data.headerNote).toBe('Thank you for your business.')

    const get = await call('/api/settings/invoice', { headers })
    expect(get.status).toBe(200)
    expect(get.body.data.prefix).toBe('ACME')
    expect(get.body.data.taxNumber).toBe('VAT-310123456')
    expect(get.body.data.footerNote).toBe('Payments due within 30 days.')
    expect(get.body.data.address.city).toBe('Jeddah')
    expect(get.body.data.phone).toBe('+966512345678')
    expect(get.body.data.layout).toBe('compact')
  })

  it('creates invoices (invoice + credit note) number-prefixed with the customization', async () => {
    const created = await call('/api/invoices', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ orderId })
    })
    expect(created.status).toBe(200)
    invoiceId = created.body.data.id
    expect(created.body.data.invoiceNumber).toMatch(/^ACME-\d{4}$/)

    const credit = await call('/api/invoices', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, type: 'credit_note' })
    })
    expect(credit.status).toBe(200)
    creditId = credit.body.data.id
    expect(credit.body.data.invoiceType).toBe('credit_note')
  })

  it('returns a non-empty application/pdf for the invoice', async () => {
    const res = await call(`/api/invoices/${invoiceId}/pdf`, { headers })
    expect(res.status).toBe(200)
    expect((res.headers.get('content-type') ?? '').toLowerCase()).toContain('application/pdf')
    expect(String(Object.fromEntries(res.headers)['content-disposition'] ?? '')).toContain('ACME')
    const bytes = new Uint8Array(res.body as ArrayBuffer)
    expect(bytes.length).toBeGreaterThan(1500)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('returns a non-empty application/pdf for the credit note', async () => {
    const res = await call(`/api/invoices/${creditId}/pdf`, { headers })
    expect(res.status).toBe(200)
    const bytes = new Uint8Array(res.body as ArrayBuffer)
    expect(bytes.length).toBeGreaterThan(1500)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('rejects PDF downloads for invoices outside the branch scope', async () => {
    const res = await call(`/api/invoices/${foreignInvoiceId}/pdf`, { headers: scopedHeaders })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('OUTLET_SCOPE')

    const allowed = await call(`/api/invoices/${foreignInvoiceId}/pdf`, { headers })
    expect(allowed.status).toBe(200)
    const bytes = new Uint8Array(allowed.body as ArrayBuffer)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('renders Arabic content with an embedded Arabic font', async () => {
    const { renderInvoicePdf } = await import('../src/modules/invoices/pdf')
    const buf = await renderInvoicePdf({
      invoice: {
        invoiceNumber: 'ACME-AR-1',
        invoiceDate: new Date(),
        status: 'paid',
        invoiceType: 'invoice',
        subtotal: 50,
        discountTotal: 0,
        shippingTotal: 0,
        taxTotal: 0,
        total: 50,
        gstin: null,
        billingAddress: {
          name: 'أحمد محمد',
          line1: 'شارع السالمية ١٢',
          city: 'مدينة الكويت',
          country: 'الكويت'
        },
        shippingAddress: null
      } as never,
      order: { orderNumber: 'ORD-AR-1', currency: 'KWD', billingAddress: null, shippingAddress: null } as never,
      items: [{ name: 'منتج تجريبي (Widget)', sku: 'SKU-AR', price: 50, quantity: 1, total: 50 }],
      settings: {
        businessName: 'متجر الكويت',
        headerNote: 'شكرا لكم',
        footerNote: 'الإرجاع خلال ١٤ يوم',
        displayFields: { columns: ['item', 'sku', 'qty', 'price', 'total'], showDiscount: true, showTax: true },
        layout: 'standard'
      },
      store: { name: 'Fallback', logo: null },
      customerName: 'أحمد محمد'
    })
    expect(buf.length).toBeGreaterThan(1500)
    const raw = buf.toString('latin1')
    expect(raw.slice(0, 5)).toBe('%PDF-')
    // Arabic font must be embedded (no tofu boxes), Helvetica kept for Latin.
    expect(raw).toContain('NotoNaskhArabic')
    expect(raw).toContain('Helvetica')
  })
})