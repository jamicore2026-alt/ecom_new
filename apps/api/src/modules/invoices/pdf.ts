import PDFDocument from 'pdfkit'
import type { Invoice, Order, OrderItem, StoreSettings } from '../../database/schema'
import type { Address } from '../../shared/types'

type InvoiceSettingsShape = {
  prefix?: string
  logo?: string | null
  businessName?: string | null
  address?: Address
  phone?: string | null
  email?: string | null
  taxLabel?: string | null
  taxNumber?: string | null
  headerNote?: string | null
  footerNote?: string | null
  displayFields?: { columns: string[]; showDiscount: boolean; showTax: boolean }
  layout?: string | null
}

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n ?? 0)

const addressLines = (a: Address | null | undefined): string[] => {
  if (!a) return []
  const lines = [a.name, a.line1, a.line2].filter(Boolean) as string[]
  const cityPost = [a.city, a.state, a.postalCode].filter(Boolean).join(', ')
  if (cityPost) lines.push(cityPost)
  if (a.country) lines.push(a.country)
  if (a.phone) lines.push(a.phone)
  return lines
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

const VALID_COLUMNS = ['item', 'sku', 'qty', 'price', 'total']

/**
 * Render an invoice/credit-note PDF on demand. Layout and merchant details come
 * from the merchant's `invoice_settings` (invoice customization); missing values
 * fall back to store settings.
 */
export async function renderInvoicePdf(args: {
  invoice: Invoice
  order: Order
  items: Pick<OrderItem, 'name' | 'sku' | 'price' | 'quantity' | 'total'>[]
  settings: InvoiceSettingsShape
  store: Pick<StoreSettings, 'name' | 'logo'> | null
}): Promise<Buffer> {
  const { invoice, order, items, settings, store } = args
  const isCredit = invoice.invoiceType === 'credit_note'
  const businessName =
    settings.businessName?.trim() || store?.name?.trim() || 'Business'
  const layout = settings.layout === 'compact' ? 'compact' : 'standard'
  const displayFields = settings.displayFields ?? {
    columns: ['item', 'sku', 'qty', 'price', 'total'],
    showDiscount: true,
    showTax: true
  }
  const columns = VALID_COLUMNS.filter((c) => displayFields.columns.includes(c))
  const showDiscount = displayFields.showDiscount !== false && (invoice.discountTotal ?? 0) !== 0
  const showTax = displayFields.showTax !== false && (invoice.taxTotal ?? 0) !== 0
  const currency = order.currency || 'USD'

  const doc = new PDFDocument({ size: 'A4', margin: layout === 'compact' ? 36 : 52, bufferPages: false })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const base = layout === 'compact' ? 8.5 : 10
  const small = layout === 'compact' ? 7 : 8.5
  const label = { fontSize: small, color: '#6b7280' }
  const value = { fontSize: base, color: '#111827' }

  const writeLine = (text: string, opts: { fontSize?: number; color?: string; bold?: boolean } = {}) => {
    doc
      .font(`Helvetica${opts.bold ? '-Bold' : ''}`)
      .fontSize(opts.fontSize ?? base)
      .fillColor(opts.color ?? '#111827')
      .text(text)
  }

  const keyValue = (k: string, v: string, opts: { bold?: boolean } = {}) => {
    doc
      .font('Helvetica')
      .fontSize(small)
      .fillColor('#6b7280')
      .text(k, undefined, undefined, { continued: true })
    doc
      .font(`Helvetica${opts.bold ? '-Bold' : ''}`)
      .fontSize(base)
      .fillColor('#111827')
      .text(`  ${v}`)
  }

  // Logo — attempt to embed from a URL; silently continue when unavailable.
  if (settings.logo) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 4000)
      const res = await fetch(settings.logo, { signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        doc.image(buf, doc.page.margins.left, doc.page.margins.top, { width: 96 })
      }
    } catch {
      /* logo is optional — fall through */
    }
  }

  doc.y = (settings.logo ? 130 : doc.page.margins.top) + 4

  // ---------- header ----------
  writeLine(businessName, { fontSize: layout === 'compact' ? 16 : 20, bold: true, color: '#111827' })
  const addr = addressLines(settings.address as Address | null | undefined)
  for (const line of addr.slice(0, 3)) writeLine(line, { fontSize: small, color: '#6b7280' })
  doc.moveDown(0.4)

  // ---------- invoice meta ----------
  keyValue('Invoice', invoice.invoiceNumber, { bold: true })
  keyValue('Date', fmtDate(new Date(invoice.invoiceDate)))
  keyValue('Status', invoice.status)
  if (invoice.gstin) keyValue(settings.taxLabel?.trim() || 'Tax number', invoice.gstin)
  if (settings.taxNumber) keyValue(settings.taxLabel?.trim() || 'Tax number', settings.taxNumber)
  doc.moveDown(0.6)

  // ---------- bill to ----------
  writeLine(isCredit ? 'Bill To / Credit To' : 'Bill To', { bold: true, fontSize: base })
  const bill = addressLines((invoice.billingAddress as Address | null) ?? order.billingAddress ?? undefined)
  for (const line of bill.slice(0, 5)) writeLine(line, { fontSize: small, color: '#374151' })

  const ship = addressLines((invoice.shippingAddress as Address | null) ?? order.shippingAddress ?? undefined)
  const sameAddress =
    bill.length > 0 && ship.length > 0 && bill.every((l, i) => ship[i] === l)
  if (ship.length > 0 && !sameAddress) {
    const shipX = doc.x + (layout === 'compact' ? 200 : 260)
    const shipY = doc.y - (bill.length > 0 ? ship.length + 2 : 0) * (layout === 'compact' ? 10 : 12)
    if (shipY > 40) {
      doc.font('Helvetica-Bold').fontSize(base).fillColor('#111827')
      doc.text('Ship To', doc.x + (layout === 'compact' ? 200 : 260), shipY)
      doc.font('Helvetica').fontSize(small).fillColor('#374151')
      let y = shipY + (base + 2)
      for (const line of ship.slice(0, 5)) {
        doc.text(line, shipX, y)
        y += layout === 'compact' ? 10 : 12
      }
    }
  }
  doc.moveDown(0.6)

  // ---------- header note ----------
  if (settings.headerNote) {
    doc.moveDown(0.2)
    doc.font('Helvetica-Oblique').fontSize(small).fillColor('#4b5563')
    doc.text(settings.headerNote, { width: doc.page.width - doc.page.margins.left * 2 })
    doc.moveDown(0.3)
  }

  // ---------- line items ----------
  const tableLeft = doc.page.margins.left
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const rowPad = layout === 'compact' ? 3 : 4.5

  const colWidth = (fraction: number) => (fraction / 100) * tableWidth
  // column fractions (percent)
  const widths: Record<string, number> = {
    item: columns.includes('sku') ? 34 : columns.length <= 3 ? 55 : 40,
    sku: 18,
    qty: 10,
    price: 16,
    total: columns.filter((c) => c !== 'item').length >= 3 ? 18 : 22
  }

  const headerY = doc.y
  let rowY = headerY + (rowPad * 2 + (layout === 'compact' ? 10 : 12))

  // header row
  doc.rect(tableLeft, headerY, tableWidth, rowPad * 2 + (layout === 'compact' ? 10 : 12)).fill('#f3f4f6')
  let x = tableLeft
  for (const c of columns) {
    doc
      .font('Helvetica-Bold')
      .fontSize(small)
      .fillColor('#111827')
      .text(c.toUpperCase(), x, headerY + rowPad, { width: colWidth(widths[c]) - 6 })
    x += colWidth(widths[c])
  }

  // item rows
  doc.font('Helvetica').fontSize(base).fillColor('#111827')
  for (const item of items) {
    if (rowY > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage()
      rowY = doc.page.margins.top
    }
    const name = isCredit ? `${item.name} (credit)` : item.name
    x = tableLeft
    for (const c of columns) {
      const cellX = x
      switch (c) {
        case 'item':
          doc.text(name, cellX, rowY, { width: colWidth(widths[c]) - 6 })
          break
        case 'sku':
          doc.text(item.sku ?? '—', cellX, rowY, { width: colWidth(widths[c]) - 6 })
          break
        case 'qty':
          doc.text(String(item.quantity), cellX, rowY, { width: colWidth(widths[c]) - 6, align: 'right' })
          break
        case 'price':
          doc.text(money(Number(item.price), currency), cellX, rowY, { width: colWidth(widths[c]) - 6, align: 'right' })
          break
        case 'total':
          doc.text(money(Number(item.total), currency), cellX, rowY, { width: colWidth(widths[c]) - 6, align: 'right' })
          break
      }
      x += colWidth(widths[c])
    }
    rowY += layout === 'compact' ? 12 : 16
    doc.moveTo(tableLeft, rowY - (layout === 'compact' ? 4 : 5))
    doc.strokeColor('#e5e7eb').lineWidth(0.5).stroke()
  }

  // ---------- totals ----------
  const totalsX = tableLeft + tableWidth * (columns.includes('item') ? 0.55 : 0.3)
  const totalsW = tableWidth * 0.45
  const totalRow = (labelText: string, val: string, bold = false, color = '#111827') => {
    doc
      .font(`Helvetica${bold ? '-Bold' : ''}`)
      .fontSize(base)
      .fillColor(color)
      .text(labelText, totalsX, doc.y, { width: totalsW, continued: true, align: 'right' })
    doc.text(val, { width: totalsW, align: 'right' })
  }
  doc.y = Math.max(rowY + (layout === 'compact' ? 6 : 10), doc.page.margins.top + 60)
  totalRow('Subtotal', money(Number(invoice.subtotal), currency))
  if (showDiscount && (invoice.discountTotal ?? 0) !== 0)
    totalRow('Discount', `−${money(Math.abs(Number(invoice.discountTotal ?? 0)), currency)}`)
  if ((invoice.shippingTotal ?? 0) !== 0)
    totalRow('Shipping', money(Number(invoice.shippingTotal), currency))
  if (showTax && (invoice.taxTotal ?? 0) !== 0)
    totalRow(settings.taxLabel?.trim() || 'Tax', money(Number(invoice.taxTotal), currency))
  doc.moveDown(0.3)
  doc.moveTo(totalsX, doc.y).lineTo(totalsX + totalsW, doc.y).lineWidth(0.5).strokeColor('#9ca3af').stroke()
  doc.moveDown(0.3)
  totalRow(isCredit ? 'Credit Total' : 'Total', money(Number(invoice.total), currency), true, '#111827')

  // ---------- footer ----------
  if (settings.footerNote) {
    doc.moveDown(0.8)
    doc.font('Helvetica-Oblique').fontSize(small).fillColor('#6b7280')
    doc.text(settings.footerNote, { width: totalsX + totalsW, align: 'center' })
  }

  if (settings.phone || settings.email) {
    doc.moveDown(0.4)
    const contact = [settings.phone, settings.email].filter(Boolean).join(' · ')
    doc.font('Helvetica').fontSize(small).fillColor('#9ca3af')
    doc.text(contact, { width: totalsX + totalsW, align: 'center' })
  }

  doc.end()
  return done
}