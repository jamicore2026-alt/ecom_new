import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { invoices, orderItems, orders, storeSettings } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'

export class InvoicesService {
  /** Generate the next invoice number for a merchant (e.g. INV-0001). */
  private static async nextInvoiceNumber(merchantId: string): Promise<string> {
    const [settings] = await db
      .select({ name: storeSettings.name })
      .from(storeSettings)
      .where(eq(storeSettings.merchantId, merchantId))
    const prefix = settings?.name ? sanitizePrefix(settings.name) : 'INV'

    const [row] = await db
      .select({ number: invoices.invoiceNumber })
      .from(invoices)
      .where(eq(invoices.merchantId, merchantId))
      .orderBy(desc(invoices.invoiceNumber))
      .limit(1)

    const lastNumber = row?.number ? parseInt(row.number.split('-').pop() ?? '0', 10) : 0
    return `${prefix}-${String(lastNumber + 1).padStart(4, '0')}`
  }

  /** Create an invoice (or credit note) for an order. Idempotent per order+type. */
  static async create(
    merchantId: string,
    input: { orderId: string; type?: 'invoice' | 'credit_note'; gstin?: string }
  ) {
    const type = input.type ?? 'invoice'
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found')

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

    const invoiceNumber = await this.nextInvoiceNumber(merchantId)

    const [invoice] = await db
      .insert(invoices)
      .values({
        merchantId,
        orderId: order.id,
        invoiceNumber,
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

    return ok(invoice)
  }

  static async list(merchantId: string, query: { page?: string; limit?: string } = {}) {
    const { page, limit, offset } = parsePagination(query)
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.merchantId, merchantId))
      .orderBy(desc(invoices.invoiceDate))
      .limit(limit)
      .offset(offset)
    return ok({ items: rows, meta: makeMeta(page, limit, rows.length) })
  }

  static async get(merchantId: string, id: string) {
    const [row] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.merchantId, merchantId)))
    if (!row) throw notFound('INVOICE_NOT_FOUND', 'Invoice not found')
    return ok(row)
  }

  static async getByOrder(merchantId: string, orderId: string) {
    const rows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.merchantId, merchantId)))
    return ok({ items: rows })
  }
}

const sanitizePrefix = (name: string) => {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10)
  return cleaned || 'INV'
}
