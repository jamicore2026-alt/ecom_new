import path from 'node:path'
import { existsSync } from 'node:fs'
import PDFDocument from 'pdfkit'
import ArabicReshaper from 'arabic-reshaper'
import bidiFactory from 'bidi-js'
import type { Invoice, Order, OrderItem, StoreSettings } from '../../database/schema'
import type { Address } from '../../shared/types'
import { roundForCurrency } from '../../shared/currency'

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
  layoutStyle?: string | null
  tableStyle?: string | null
  fontFamily?: string | null
  accentColor?: string | null
  paperFormat?: string | null
  tagline?: string | null
  bankAccount?: string | null
  showQr?: boolean | null
}

type InvoiceLineItem = Pick<OrderItem, 'name' | 'sku' | 'price' | 'quantity' | 'total'> & {
  /** VAT rate (%) snapshot from order_items — drives the per-line breakdown. */
  vatRate?: number | string | null
}

const vatRateOf = (item: InvoiceLineItem): number | null => {
  const n = Number(item.vatRate ?? NaN)
  return Number.isFinite(n) && n > 0 ? n : null
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

/** Active Latin typeface for this render (Arabic runs always use embedded
 *  Naskh for glyph coverage). Set once at render start; module state is safe
 *  because a render is fully synchronous once begun. */
let LATIN = 'Helvetica'
let LATIN_BOLD = 'Helvetica-Bold'
let LATIN_ITALIC = 'Helvetica-Oblique'

function setLatinFace(family: string | null | undefined) {
  if (family === 'times') {
    LATIN = 'Times-Roman'
    LATIN_BOLD = 'Times-Bold'
    LATIN_ITALIC = 'Times-Italic'
  } else {
    LATIN = 'Helvetica'
    LATIN_BOLD = 'Helvetica-Bold'
    LATIN_ITALIC = 'Helvetica-Oblique'
  }
}

const LAYOUT_STYLES = ['light', 'bubble', 'wave', 'folder', 'center', 'dual', 'lines'] as const
const TABLE_STYLES = ['light', 'boxed', 'bold', 'striped', 'bubble', 'column'] as const

function pick<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function validAccent(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : '#004ac6'
}

const VALID_COLUMNS = ['item', 'sku', 'qty', 'price', 'total']

/* ------------------------- Arabic (RTL) support ------------------------- */
/**
 * PDFKit ships Helvetica (WinAnsi) with no Arabic glyphs and no complex-text
 * shaping, so Arabic would print as disconnected reversed letters. We embed
 * Noto Naskh Arabic (OFL, in `apps/api/assets/fonts/`) and convert every
 * user-content string to visual order before printing:
 *   logical text → arabic-reshaper (presentation forms) → bidi-js reorder +
 *   mirroring → visual string rendered LTR with the Arabic font.
 * Latin runs keep Helvetica. When the font files are missing (unexpected),
 * text falls back to the old Helvetica passthrough — never a crash.
 */
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u
// Explicit escapes (same ranges, no invisible-char ambiguity):
// \u0600-\u06FF Arabic · \u0750-\u077F Arabic Supplement ·
// \uFB50-\uFDFF Presentation Forms-A · \uFE70-\uFEFF Presentation Forms-B
const AR_FONT = 'NotoNaskhArabic'
const AR_FONT_BOLD = 'NotoNaskhArabic-Bold'
const hasArabic = (s: string) => ARABIC_RE.test(s)

const bidi = bidiFactory()

const fontDir = path.join(import.meta.dir, '../../../assets/fonts')
const arFontsAvailable =
  existsSync(path.join(fontDir, 'NotoNaskhArabic-Regular.ttf')) &&
  existsSync(path.join(fontDir, 'NotoNaskhArabic-Bold.ttf'))

/** Logical-order string → visual-order string ready for PDFKit (LTR trick). */
function toVisual(logical: string): string {
  const shaped = ArabicReshaper.convertArabic(logical)
  try {
    // getReorderedString also swaps RTL-mirrored brackets.
    return bidi.getReorderedString(shaped, bidi.getEmbeddingLevels(shaped))
  } catch {
    // Bidi failure must never break an invoice — fall back to shaped text.
    return shaped
  }
}

/** Base direction of a line (first paragraph level from the bidi algorithm). */
function isRtlLine(s: string): boolean {
  try {
    const levels = bidi.getEmbeddingLevels(s)
    return (levels.paragraphs?.[0]?.level ?? 0) % 2 === 1
  } catch {
    return true
  }
}

type PdfDoc = InstanceType<typeof PDFDocument>

function registerArabicFonts(doc: PdfDoc): boolean {
  if (!arFontsAvailable) return false
  try {
    doc.registerFont(AR_FONT, path.join(fontDir, 'NotoNaskhArabic-Regular.ttf'))
    doc.registerFont(AR_FONT_BOLD, path.join(fontDir, 'NotoNaskhArabic-Bold.ttf'))
    return true
  } catch {
    return false
  }
}

/**
 * Print one logical line, switching fonts per script run. Arabic runs are
 * reshaped + reordered; pure-Arabic lines are right-aligned. Static English
 * labels bypass this (printed directly with Helvetica by callers).
 */
type MixedAlign = 'left' | 'right' | 'center'
interface MixedOpts {
  fontSize?: number
  color?: string
  bold?: boolean
  align?: MixedAlign
  width?: number
  x?: number
  y?: number
}

function printMixed(doc: PdfDoc, useArabic: boolean, text: string, opts: MixedOpts = {}) {
  const { fontSize = 10, color = '#111827', bold = false, align, width, x, y } = opts
  const baseOpts: { width?: number; align?: MixedAlign } = {}
  if (width !== undefined) baseOpts.width = width
  if (align) baseOpts.align = align
  const atXY = x !== undefined && y !== undefined
  if (!useArabic || !hasArabic(text)) {
    doc
      .font((bold ? LATIN_BOLD : LATIN))
      .fontSize(fontSize)
      .fillColor(color)
    if (atXY) doc.text(text, x, y, baseOpts)
    else doc.text(text, baseOpts)
    return
  }
  // Split into Arabic / non-Arabic runs by testing each character.
  const runs: { arabic: boolean; text: string }[] = []
  let current = ''
  let currentArabic = false
  let started = false
  for (const ch of text) {
    const a = ARABIC_RE.test(ch)
    if (!started) {
      currentArabic = a
      started = true
    }
    if (a === currentArabic) {
      current += ch
    } else {
      runs.push({ arabic: currentArabic, text: current })
      current = ch
      currentArabic = a
    }
  }
  if (current) runs.push({ arabic: currentArabic, text: current })
  const lineAlign = align ?? (isRtlLine(text) ? 'right' : 'left')
  const arFont = bold ? AR_FONT_BOLD : AR_FONT
  if (runs.every((r) => r.arabic)) {
    // Pure-Arabic line: single shaped pass, one font, right-aligned.
    doc.font(arFont).fontSize(fontSize).fillColor(color)
    const lineOpts: { width?: number; align?: MixedAlign } = { align: lineAlign }
    if (width !== undefined) lineOpts.width = width
    if (atXY) doc.text(toVisual(text), x, y, lineOpts)
    else doc.text(toVisual(text), lineOpts)
    return
  }
  runs.forEach((run, i) => {
    const last = i === runs.length - 1
    const runOpts: { width?: number; align?: MixedAlign; continued?: boolean } = {}
    if (i === 0) {
      if (width !== undefined) runOpts.width = width
      runOpts.align = lineAlign
    }
    if (!last) runOpts.continued = true
    doc
      .font(run.arabic ? arFont : (bold ? LATIN_BOLD : LATIN))
      .fontSize(fontSize)
      .fillColor(color)
    const runText = run.arabic ? toVisual(run.text) : run.text
    if (i === 0 && atXY) doc.text(runText, x, y, runOpts)
    else doc.text(runText, runOpts)
  })
}

/**
 * Render an invoice/credit-note PDF on demand. Layout and merchant details come
 * from the merchant's `invoice_settings` (invoice customization); missing values
 * fall back to store settings.
 */
export async function renderInvoicePdf(args: {
  invoice: Invoice
  order: Order
  items: InvoiceLineItem[]
  settings: InvoiceSettingsShape
  store: Pick<StoreSettings, 'name' | 'logo'> | null
  /** Shopper display name — prepended to the bill-to block when the stored
   *  address has no name line of its own. */
  customerName?: string | null
}): Promise<Buffer> {
  const { invoice, order, items, settings, store } = args
  // Arabic (RTL) support: embed Noto Naskh Arabic and print every
  // user-content string through printMixed (shaping + bidi + font switch).
  let useArabic = false
  const isCredit = invoice.invoiceType === 'credit_note'
  const businessName =
    settings.businessName?.trim() || store?.name?.trim() || 'Business'
  const layout = settings.layout === 'compact' ? 'compact' : 'standard'
  const layoutStyle = pick(settings.layoutStyle, LAYOUT_STYLES, 'light')
  const tableStyle = pick(settings.tableStyle, TABLE_STYLES, 'light')
  setLatinFace(settings.fontFamily)
  const accent = validAccent(settings.accentColor)
  const showQr = settings.showQr === true
  const tagline = settings.tagline?.trim() || null
  const bankAccount = settings.bankAccount?.trim() || null
  const displayFields = settings.displayFields ?? {
    columns: ['item', 'sku', 'qty', 'price', 'total'],
    showDiscount: true,
    showTax: true
  }
  const columns = VALID_COLUMNS.filter((c) => displayFields.columns.includes(c))
  const showDiscount = displayFields.showDiscount !== false && (invoice.discountTotal ?? 0) !== 0
  const showTax = displayFields.showTax !== false && (invoice.taxTotal ?? 0) !== 0
  const currency = order.currency || 'USD'

  const doc = new PDFDocument({
    size: settings.paperFormat === 'Letter' ? 'LETTER' : 'A4',
    margin: layout === 'compact' ? 36 : 52,
    bufferPages: false
  })
  useArabic = registerArabicFonts(doc)
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
    printMixed(doc, useArabic, text, {
      fontSize: opts.fontSize ?? base,
      color: opts.color ?? '#111827',
      bold: opts.bold
    })
  }

  const keyValue = (k: string, v: string, opts: { bold?: boolean } = {}) => {
    doc
      .font(LATIN)
      .fontSize(small)
      .fillColor('#6b7280')
      .text(k, undefined, undefined, { continued: true })
    if (useArabic && hasArabic(v)) {
      // Value continues the label line: print the value run on the same line.
      const visual = toVisual(v)
      doc
        .font(opts.bold ? AR_FONT_BOLD : AR_FONT)
        .fontSize(base)
        .fillColor('#111827')
        .text(`  ${visual}`)
    } else {
      doc
        .font(opts.bold ? LATIN_BOLD : LATIN)
        .fontSize(base)
        .fillColor('#111827')
        .text(`  ${v}`)
    }
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

  // ---------- header (7 layout styles, one content core) ----------
  const addr = addressLines(settings.address as Address | null | undefined)
  const headerTop = doc.y
  const pageW = doc.page.width
  const marginL = doc.page.margins.left
  const marginR = doc.page.margins.right
  const contentW = pageW - marginL - marginR
  const titleSize = layout === 'compact' ? 16 : 20
  const drawTagline = (align: 'left' | 'center' | 'right' = 'left') => {
    if (!tagline) return
    printMixed(doc, useArabic, tagline, { fontSize: small, color: '#6b7280', align, width: contentW })
  }
  const drawAddr = (align: 'left' | 'center' | 'right' = 'left') => {
    for (const line of addr.slice(0, 3)) {
      printMixed(doc, useArabic, line, { fontSize: small, color: '#6b7280', align, width: contentW })
    }
  }
  if (layoutStyle === 'bubble') {
    const bandH = tagline ? 64 : 50
    doc.roundedRect(marginL, headerTop, contentW, bandH, 12).fill(accent)
    printMixed(doc, useArabic, businessName, { fontSize: titleSize, color: '#ffffff', bold: true, x: marginL + 16, y: headerTop + 10, width: contentW - 32 })
    if (tagline) printMixed(doc, useArabic, tagline, { fontSize: small, color: '#ffffff', x: marginL + 16, y: headerTop + 34, width: contentW - 32 })
    doc.y = headerTop + bandH + 8
    drawAddr()
  } else if (layoutStyle === 'wave') {
    const bandH = 56
    doc
      .moveTo(marginL, headerTop + bandH)
      .bezierCurveTo(marginL + contentW * 0.3, headerTop + bandH - 22, marginL + contentW * 0.7, headerTop + bandH + 6, pageW - marginR, headerTop + bandH - 14)
      .lineTo(pageW - marginR, headerTop)
      .lineTo(marginL, headerTop)
      .closePath()
      .fill(accent)
    printMixed(doc, useArabic, businessName, { fontSize: titleSize, color: '#ffffff', bold: true, x: marginL + 12, y: headerTop + 8, width: contentW - 24 })
    doc.y = headerTop + bandH + 4
    drawTagline()
    drawAddr()
  } else if (layoutStyle === 'folder') {
    const tabW = Math.min(260, contentW * 0.55)
    doc.roundedRect(marginL, headerTop, tabW, 30, 8).fill(accent)
    printMixed(doc, useArabic, businessName, { fontSize: base + 2, color: '#ffffff', bold: true, x: marginL + 12, y: headerTop + 7, width: tabW - 24 })
    doc
      .moveTo(marginL, headerTop + 30)
      .lineTo(marginL + contentW, headerTop + 30)
      .lineWidth(2)
      .strokeColor(accent)
      .stroke()
    doc.y = headerTop + 38
    drawTagline()
    drawAddr()
  } else if (layoutStyle === 'center') {
    printMixed(doc, useArabic, businessName, { fontSize: titleSize, color: '#111827', bold: true, align: 'center', width: contentW })
    drawTagline('center')
    doc
      .moveTo(marginL + contentW / 2 - 40, doc.y + 4)
      .lineTo(marginL + contentW / 2 + 40, doc.y + 4)
      .lineWidth(2)
      .strokeColor(accent)
      .stroke()
    doc.y += 10
    drawAddr('center')
  } else if (layoutStyle === 'dual') {
    const half = contentW / 2
    printMixed(doc, useArabic, businessName, { fontSize: titleSize, color: '#111827', bold: true, x: marginL, y: headerTop, width: half - 8 })
    const rightTop = doc.y
    if (tagline) printMixed(doc, useArabic, tagline, { fontSize: small, color: '#6b7280', align: 'right', x: marginL + half, y: headerTop, width: half })
    const contact = [settings.phone, settings.email].filter(Boolean).join(' · ')
    if (contact) printMixed(doc, useArabic, contact, { fontSize: small, color: '#6b7280', align: 'right', x: marginL + half, y: headerTop + (tagline ? 14 : 0), width: half })
    doc.y = Math.max(doc.y, rightTop) + 4
    drawAddr()
  } else if (layoutStyle === 'lines') {
    doc.moveTo(marginL, headerTop).lineTo(marginL + contentW, headerTop).lineWidth(2).strokeColor(accent).stroke()
    printMixed(doc, useArabic, businessName, { fontSize: titleSize, color: '#111827', bold: true, x: marginL, y: headerTop + 6, width: contentW })
    drawTagline()
    drawAddr()
    doc
      .moveTo(marginL, doc.y + 4)
      .lineTo(marginL + contentW, doc.y + 4)
      .lineWidth(0.5)
      .strokeColor('#9ca3af')
      .stroke()
    doc.y += 8
  } else {
    writeLine(businessName, { fontSize: titleSize, bold: true, color: '#111827' })
    drawTagline()
    drawAddr()
  }
  doc.moveDown(0.4)

  // ---------- invoice meta ----------
  keyValue('Invoice', invoice.invoiceNumber, { bold: true })
  keyValue('Order', order.orderNumber)
  keyValue('Date', fmtDate(new Date(invoice.invoiceDate)))
  keyValue('Status', invoice.status)
  if (invoice.gstin) keyValue(settings.taxLabel?.trim() || 'Tax number', invoice.gstin)
  if (settings.taxNumber) keyValue(settings.taxLabel?.trim() || 'Tax number', settings.taxNumber)
  doc.moveDown(0.6)

  // ---------- bill to ----------
  writeLine(isCredit ? 'Bill To / Credit To' : 'Bill To', { bold: true, fontSize: base })
  const bill = addressLines((invoice.billingAddress as Address | null) ?? order.billingAddress ?? undefined)
  // The stored address may carry no name (guest checkout) — fall back to the
  // shopper's customer record so the bill-to block always names someone.
  const customerName = args.customerName?.trim()
  if (customerName && bill[0] !== customerName) bill.unshift(customerName)
  for (const line of bill.slice(0, 5)) writeLine(line, { fontSize: small, color: '#374151' })

  const ship = addressLines((invoice.shippingAddress as Address | null) ?? order.shippingAddress ?? undefined)
  const sameAddress =
    bill.length > 0 && ship.length > 0 && bill.every((l, i) => ship[i] === l)
  if (ship.length > 0 && !sameAddress) {
    const shipX = doc.x + (layout === 'compact' ? 200 : 260)
    const shipY = doc.y - (bill.length > 0 ? ship.length + 2 : 0) * (layout === 'compact' ? 10 : 12)
    if (shipY > 40) {
      doc.font(LATIN_BOLD).fontSize(base).fillColor('#111827')
      doc.text('Ship To', doc.x + (layout === 'compact' ? 200 : 260), shipY)
      doc.font(LATIN).fontSize(small).fillColor('#374151')
      let y = shipY + (base + 2)
      for (const line of ship.slice(0, 5)) {
        printMixed(doc, useArabic, line, { fontSize: small, color: '#374151', x: shipX, y })
        y += layout === 'compact' ? 10 : 12
      }
    }
  }
  doc.moveDown(0.6)

  // ---------- header note ----------
  if (settings.headerNote) {
    doc.moveDown(0.2)
    printMixed(doc, useArabic, settings.headerNote, {
      fontSize: small,
      color: '#4b5563',
      width: doc.page.width - doc.page.margins.left * 2
    })
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
  const headerH = rowPad * 2 + (layout === 'compact' ? 10 : 12)
  let rowY = headerY + headerH

  // header row per table style
  const headerText = tableStyle === 'bold' ? '#ffffff' : '#111827'
  if (tableStyle === 'bold') {
    doc.rect(tableLeft, headerY, tableWidth, headerH).fill('#111827')
  } else if (tableStyle === 'light' || tableStyle === 'striped') {
    doc.rect(tableLeft, headerY, tableWidth, headerH).fill('#f3f4f6')
  } else if (tableStyle === 'column') {
    doc.rect(tableLeft, headerY, tableWidth, headerH).fill('#f3f4f6')
    doc.rect(tableLeft, headerY, 3, headerH).fill(accent)
  }
  let x = tableLeft
  for (const c of columns) {
    doc
      .font(LATIN_BOLD)
      .fontSize(small)
      .fillColor(headerText)
      .text(c.toUpperCase(), x, headerY + rowPad, { width: colWidth(widths[c]) - 6 })
    if (tableStyle === 'boxed') {
      doc.rect(x, headerY, colWidth(widths[c]), headerH).lineWidth(0.5).strokeColor('#d1d5db').stroke()
    }
    x += colWidth(widths[c])
  }

  // item rows
  doc.font(LATIN).fontSize(base).fillColor('#111827')
  const rowH = layout === 'compact' ? 12 : 16
  items.forEach((item, rowIdx) => {
    if (rowY > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage()
      rowY = doc.page.margins.top
    }
    if (tableStyle === 'striped' && rowIdx % 2 === 1) {
      doc.rect(tableLeft, rowY - 2, tableWidth, rowH + 2).fill('#f8fafc')
    }
    if (tableStyle === 'bubble') {
      doc.roundedRect(tableLeft, rowY - 2, tableWidth, rowH + 2, 6).fill('#f3f4f6')
    }
    if (tableStyle === 'column') {
      doc.rect(tableLeft, rowY - 2, 3, rowH + 2).fill(accent)
    }
    const name = `${isCredit ? `${item.name} (credit)` : item.name}${vatRateOf(item) !== null ? ` — ${vatRateOf(item)}% VAT` : ''}`
    x = tableLeft
    for (const c of columns) {
      const cellX = x
      const cellW = colWidth(widths[c]) - 6
      switch (c) {
        case 'item':
          printMixed(doc, useArabic, name, {
            fontSize: base,
            color: '#111827',
            x: cellX,
            y: rowY,
            width: cellW
          })
          break
        case 'sku':
          doc.font(LATIN).fontSize(base).fillColor('#111827')
          doc.text(item.sku ?? '—', cellX, rowY, { width: cellW })
          break
        case 'qty':
          doc.font(LATIN).fontSize(base).fillColor('#111827')
          doc.text(String(item.quantity), cellX, rowY, { width: cellW, align: 'right' })
          break
        case 'price':
          doc.font(LATIN).fontSize(base).fillColor('#111827')
          doc.text(money(Number(item.price), currency), cellX, rowY, { width: cellW, align: 'right' })
          break
        case 'total':
          doc.font(LATIN).fontSize(base).fillColor('#111827')
          doc.text(money(Number(item.total), currency), cellX, rowY, { width: cellW, align: 'right' })
          break
      }
      if (tableStyle === 'boxed') {
        doc.rect(cellX, rowY - 2, colWidth(widths[c]), rowH + 2).lineWidth(0.5).strokeColor('#d1d5db').stroke()
      }
      x += colWidth(widths[c])
    }
    rowY += rowH
    if (tableStyle === 'light' || tableStyle === 'bold' || tableStyle === 'column') {
      doc.moveTo(tableLeft, rowY - (layout === 'compact' ? 4 : 5))
      doc.strokeColor(tableStyle === 'column' ? accent : '#e5e7eb').lineWidth(0.5).stroke()
    }
  })

  // ---------- totals (explicit two-column rows — label and value can
  // never overlap: each gets its own box and doc.y advances per row) ----------
  const totalsX = tableLeft + tableWidth * (columns.includes('item') ? 0.55 : 0.3)
  const totalsW = tableWidth * 0.45
  const labelW = totalsW * 0.55
  const valueW = totalsW - labelW
  const lineH = base + 6
  doc.y = Math.max(rowY + (layout === 'compact' ? 6 : 10), doc.page.margins.top + 60)
  const totalRow = (labelText: string, val: string, bold = false, color = '#111827') => {
    const labelArabic = useArabic && hasArabic(labelText)
    doc
      .font(labelArabic ? (bold ? AR_FONT_BOLD : AR_FONT) : bold ? LATIN_BOLD : LATIN)
      .fontSize(base)
      .fillColor(color)
    if (labelArabic) {
      doc.text(toVisual(labelText), totalsX, doc.y, { width: labelW, align: 'right' })
    } else {
      doc.text(labelText, totalsX, doc.y, { width: labelW, align: 'right' })
    }
    doc.font(bold ? LATIN_BOLD : LATIN).fontSize(base).fillColor(color)
    doc.text(val, totalsX + labelW, doc.y, { width: valueW, align: 'right' })
    doc.y += lineH
  }
  doc.y = Math.max(rowY + (layout === 'compact' ? 6 : 10), doc.page.margins.top + 60)
  totalRow('Subtotal', money(Number(invoice.subtotal), currency))
  if (showDiscount && (invoice.discountTotal ?? 0) !== 0)
    totalRow('Discount', `−${money(Math.abs(Number(invoice.discountTotal ?? 0)), currency)}`)
  if ((invoice.shippingTotal ?? 0) !== 0)
    totalRow('Shipping', money(Number(invoice.shippingTotal), currency))
  if (showTax && (invoice.taxTotal ?? 0) !== 0)
    totalRow(settings.taxLabel?.trim() || 'Tax', money(Number(invoice.taxTotal), currency))
  // Per-line VAT breakdown from the order_items.vatRate snapshot: each distinct
  // rate gets a row with the VAT portion (rate% of the grouped line totals).
  const vatGroups = new Map<number, number>()
  for (const item of items) {
    const rate = vatRateOf(item)
    if (rate !== null) vatGroups.set(rate, (vatGroups.get(rate) ?? 0) + Number(item.total))
  }
  for (const [rate, base] of [...vatGroups].sort((a, b) => a[0] - b[0])) {
    totalRow(`VAT ${rate}%`, money(roundForCurrency((base * rate) / 100, currency), currency))
  }
  doc.moveDown(0.3)
  doc.moveTo(totalsX, doc.y).lineTo(totalsX + totalsW, doc.y).lineWidth(0.5).strokeColor('#9ca3af').stroke()
  doc.moveDown(0.3)
  totalRow(isCredit ? 'Credit Total' : 'Total', money(Number(invoice.total), currency), true, '#111827')

  // ---------- bank details + QR ----------
  if (bankAccount) {
    doc.moveDown(0.4)
    doc.font(LATIN_BOLD).fontSize(small).fillColor('#111827')
    doc.text('Bank details', totalsX, doc.y, { width: totalsW, align: 'right' })
    printMixed(doc, useArabic, bankAccount, {
      fontSize: small,
      color: '#374151',
      x: totalsX,
      y: doc.y,
      width: totalsW,
      align: 'right'
    })
    doc.y += small + 10
  }
  if (showQr) {
    try {
      const QRCode = (await import('qrcode')).default
      const qrText = `invoice:${invoice.invoiceNumber}|order:${order.orderNumber}|total:${Number(invoice.total)}|${currency}`
      const dataUrl = await QRCode.toDataURL(qrText, { width: 96, margin: 1 })
      const qrBuf = Buffer.from(dataUrl.split(',')[1], 'base64')
      const qrY = doc.y + 4
      doc.image(qrBuf, totalsX + totalsW - 100, qrY, { width: 96 })
      doc.font(LATIN).fontSize(small).fillColor('#6b7280')
      doc.text('Scan to verify', totalsX + totalsW - 100, qrY + 100, { width: 96, align: 'center' })
      doc.y = qrY + 100 + small + 4
    } catch {
      /* QR is decorative — never break an invoice */
    }
  }

  // ---------- footer ----------
  if (settings.footerNote) {
    doc.moveDown(0.8)
    printMixed(doc, useArabic, settings.footerNote, {
      fontSize: small,
      color: '#6b7280',
      width: totalsX + totalsW,
      align: 'center'
    })
  }

  if (settings.phone || settings.email) {
    doc.moveDown(0.4)
    const contact = [settings.phone, settings.email].filter(Boolean).join(' · ')
    doc.font(LATIN).fontSize(small).fillColor('#9ca3af')
    doc.text(contact, { width: totalsX + totalsW, align: 'center' })
  }

  doc.end()
  return done
}