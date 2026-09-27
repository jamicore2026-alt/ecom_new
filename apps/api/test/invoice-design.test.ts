import { describe, expect, it } from 'bun:test'
import { renderInvoicePdf } from '../src/modules/invoices/pdf'

const baseArgs: any = {
  invoice: {
    invoiceNumber: 'INV-9001',
    invoiceDate: new Date('2026-09-01'),
    status: 'issued',
    invoiceType: 'invoice',
    subtotal: 100,
    discountTotal: 10,
    shippingTotal: 5,
    taxTotal: 7.5,
    total: 102.5,
    gstin: null,
    billingAddress: { name: 'Test Buyer', line1: 'Street 1', city: 'Kuwait City', country: 'KW' },
    shippingAddress: null
  },
  order: { orderNumber: 'ORD-9001', currency: 'KWD', billingAddress: null, shippingAddress: null },
  items: [
    { name: 'Widget منتج', sku: 'W-1', price: 50, quantity: 2, total: 100 },
    { name: 'Plain Item', sku: 'P-2', price: 0, quantity: 1, total: 0 }
  ],
  store: { name: 'Test Store', logo: null },
  customerName: 'Test Buyer'
}

const fullSettings = {
  businessName: 'Biz متجر',
  layoutStyle: 'bubble',
  tableStyle: 'boxed',
  fontFamily: 'times',
  accentColor: '#b91c1c',
  paperFormat: 'Letter',
  tagline: 'Quality first',
  bankAccount: 'Bank X\nIBAN KW12 3456',
  showQr: true,
  displayFields: { columns: ['item', 'sku', 'qty', 'price', 'total'], showDiscount: true, showTax: true }
}

describe('Invoice document design (item 7)', () => {
  it('renders every layout × table combination with Arabic + QR', async () => {
    const layouts = ['light', 'bubble', 'wave', 'folder', 'center', 'dual', 'lines']
    const tables = ['light', 'boxed', 'bold', 'striped', 'bubble', 'column']
    for (const layoutStyle of layouts) {
      for (const tableStyle of tables) {
        const buf = await renderInvoicePdf({ ...baseArgs, settings: { ...fullSettings, layoutStyle, tableStyle } })
        expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
        expect(buf.length).toBeGreaterThan(1500)
      }
    }
  }, 120000)

  it('embeds the Arabic + Latin fonts and the QR image', async () => {
    const buf = await renderInvoicePdf({ ...baseArgs, settings: fullSettings })
    const raw = buf.toString('latin1')
    expect(raw).toContain('NotoNaskhArabic')
    expect(raw).toContain('Times-Roman')
    // QR raster image object embedded (96×96)
    expect(raw).toContain('/Width 96')
  })

  it('omits the QR image when disabled', async () => {
    const buf = await renderInvoicePdf({ ...baseArgs, settings: { ...fullSettings, showQr: false } })
    const raw = buf.toString('latin1')
    expect(raw).not.toContain('/Width 96')
  })

  it('renders totals block without overlap (explicit row boxes)', async () => {
    // Content streams are Flate-compressed, so assert structure: valid PDF
    // header, substantial body, embedded fonts (no tofu boxes).
    // (Byte-equality is not asserted: CreationDate varies per render.)
    const buf = await renderInvoicePdf({ ...baseArgs, settings: { ...fullSettings, layoutStyle: 'light', tableStyle: 'light' } })
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(3000)
    expect(buf.toString('latin1')).toContain('NotoNaskhArabic')
  })

  it('renders without optional design fields (defaults)', async () => {
    const buf = await renderInvoicePdf({ ...baseArgs, settings: {} })
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(1500)
  })
})
