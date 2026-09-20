import { and, count, desc, eq, like, sql } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { invoiceSettings, invoices, orderItems, orders, storeSettings } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { assertOrderInBranchScope, branchOrderCondition } from '../../shared/outlet-scope'
import { renderInvoicePdf } from './pdf'

export class InvoicesService {
  /** Generate the next invoice number for a merchant (e.g. INV-0001, or the customized prefix). */
  private static async nextInvoiceNumber(db: DB, merchantId: string): Promise<string> {
    const [st] = await db
      .select({ prefix: invoiceSettings.prefix })
      .from(invoiceSettings)
      .where(eq(invoiceSettings.merchantId, merchantId))
    let prefix = st?.prefix?.trim()
    if (!prefix) {
      const [store] = await db
        .select({ name: storeSettings.name })
        .from(storeSettings)
        .where(eq(storeSettings.merchantId, merchantId))
      prefix = sanitizePrefix(store?.name ?? '')
    }

    const rows = await db
      .select({ number: invoices.invoiceNumber })
      .from(invoices)
      .where(and(eq(invoices.merchantId, merchantId), like(invoices.invoiceNumber, `${prefix}-%`)))

    let max = 0
    for (const r of rows) {
      const suffix = parseInt((r.number.split('-').pop() ?? '0'), 10)
      if (!Number.isNaN(suffix) && suffix > max) max = suffix
    }
    return `${prefix}-${String(max + 1).padStart(4, '0')}`
  }

  /** Create an invoice (or credit note) for an order. Idempotent per order+type. */
  static async create(
    db: DB,
    merchantId: string,
    branchIds: string[] | null,
    input: { orderId: string; type?: 'invoice' | 'credit_note'; gstin?: string }
  ) {
    const type = input.type ?? 'invoice'
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')
    assertOrderInBranchScope(branchIds, order.outletId)

    // Prevent duplicate invoices of the same type for the same order.
    const [existing] = await db
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.orderId, order.id), eq(invoices.invoiceType, type))
      )
    if (existing) throw badRequest('INVOICE_EXISTS', `A ${type.replace('_', ' ')} already exists for this order`)

    const items = await db
      .select({ name: orderItems.name, sku: orderItems.sku, price: orderItems.price, quantity: orderItems.quantity, total: orderItems.total })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))

    // Serialize number assignment + insert per merchant so concurrent creates
    // can never compute the same number. The unique index remains as backstop
    // and surfaces as 409 (retryable) instead of a masked 500.
    try {
      const [invoice] = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`invoices:${merchantId}`}))`
        )
        const number = await this.nextInvoiceNumber(tx as unknown as DB, merchantId)
        return tx
          .insert(invoices)
          .values({
            merchantId,
            orderId: order.id,
            invoiceNumber: number,
            invoiceType: type,
            status: 'issued',
            subtotal: order.subtotal,
            discountTotal: order.discountTotal,
            shippingTotal: order.shippingTotal,
            taxTotal: order.taxTotal,
            total: order.total,
            gstin: input.gstin ?? null,
            hsnCodes: items.reduce<Record<string, string>>((acc, i) => {
              if (i.sku) acc[i.sku] = i.sku
              return acc
            }, {}),
            billingAddress: (order.billingAddress as object) ?? {},
            shippingAddress: (order.shippingAddress as object) ?? {},
            invoiceDate: new Date()
          })
          .returning()
      })
      return ok(invoice)
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw conflict('INVOICE_NUMBER_CONFLICT', 'Invoice number was just taken — please retry')
      }
      throw err
    }
  }

  static async list(
    db: DB,
    merchantId: string,
    branchIds: string[] | null,
    query: { page?: string; limit?: string } = {}
  ) {
    const { page, limit, offset } = parsePagination(query)
    const scopeCondition = branchOrderCondition(branchIds)
    const where = and(
      eq(invoices.merchantId, merchantId),
      ...(scopeCondition ? [scopeCondition] : [])
    )
    const [rows, totalRows] = await Promise.all([
      db
        .select()
        .from(invoices)
        .innerJoin(orders, eq(invoices.orderId, orders.id))
        .where(where)
        .orderBy(desc(invoices.invoiceDate))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(invoices)
        .innerJoin(orders, eq(invoices.orderId, orders.id))
        .where(where)
    ])
    const total = totalRows[0]?.total ?? 0
    return ok({ items: rows.map((row) => row.invoices), meta: makeMeta(page, limit, total) })
  }

  static async get(db: DB, merchantId: string, branchIds: string[] | null, id: string) {
    const [row] = await db
      .select()
      .from(invoices)
      .innerJoin(orders, eq(invoices.orderId, orders.id))
      .where(and(eq(invoices.id, id), eq(invoices.merchantId, merchantId)))
    if (!row) throw notFound('INVOICE_NOT_FOUND', 'Invoice not found')
    assertOrderInBranchScope(branchIds, row.orders.outletId)
    return ok(row.invoices)
  }

  static async getByOrder(db: DB, merchantId: string, branchIds: string[] | null, orderId: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')
    assertOrderInBranchScope(branchIds, order.outletId)
    const rows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.merchantId, merchantId)))
    return ok({ items: rows })
  }

  /**
   * Build an on-demand PDF for an invoice (or credit note), honoring the
   * merchant's `invoice_settings` customization. Returns the raw PDF buffer
   * plus the suggested download filename.
   */
  static async pdf(db: DB, merchantId: string, branchIds: string[] | null, id: string) {
    const [row] = await db
      .select()
      .from(invoices)
      .innerJoin(orders, eq(invoices.orderId, orders.id))
      .where(and(eq(invoices.id, id), eq(invoices.merchantId, merchantId)))
    if (!row) throw notFound('INVOICE_NOT_FOUND', 'Invoice not found')
    assertOrderInBranchScope(branchIds, row.orders.outletId)

    const items = await db
      .select({ name: orderItems.name, sku: orderItems.sku, price: orderItems.price, quantity: orderItems.quantity, total: orderItems.total })
      .from(orderItems)
      .where(eq(orderItems.orderId, row.orders.id))

    const [settings] = await db
      .select()
      .from(invoiceSettings)
      .where(eq(invoiceSettings.merchantId, merchantId))

    const [store] = await db
      .select()
      .from(storeSettings)
      .where(eq(storeSettings.merchantId, merchantId))

    const buffer = await renderInvoicePdf({
      invoice: row.invoices,
      order: row.orders,
      items,
      settings: settings ?? {},
      store: store ?? null
    })

    const filename = `${(row.invoices.invoiceNumber || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`
    return { buffer, filename }
  }
}

const sanitizePrefix = (name: string) => {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10)
  return cleaned || 'INV'
}
