import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../database/client'
import {
  customers,
  inventoryLogs,
  orderItems,
  orders,
  paymentProviderConfigs,
  paymentTransactions,
  productVariants,
  publicCustomerColumns,
  refunds,
  returnsTable
} from '../../database/schema'
import { getProvider } from '../../payments/registry'
import { decryptJson } from '../../shared/crypto'
import { applyManualMarkPaid } from '../../shared/order-payments'
import { cancelPendingOrderTx } from '../../shared/order-cancel'
import { emit } from '../../shared/event-dispatch'
import { EmailsService } from '../emails/service'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import type { Order } from '../../database/schema'
import type { OrderStatus } from '../../shared/types'

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  // `refunded` is reachable ONLY through createRefund() after a real refund —
  // never via a generic status mutation.
  delivered: [],
  cancelled: [],
  refunded: []
}

/** Legal paymentStatus changes for the manual status endpoint. Refund states
 *  (partially_refunded / refunded) are owned exclusively by createRefund();
 *  `paid` must only ever come from `unpaid`. */
const PAYMENT_TRANSITIONS: Record<string, string[]> = {
  unpaid: ['paid', 'failed'],
  pending: ['paid', 'failed'], // legacy rows
  paid: [],
  partially_refunded: [],
  failed: [],
  refunded: []
}

const FULFILLMENT_TRANSITIONS: Record<string, string[]> = {
  unfulfilled: ['fulfilled'],
  fulfilled: []
}

interface OrderQuery {
  page?: string
  limit?: string
  status?: string
  paymentStatus?: string
  customerId?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

export class OrdersService {
  /* --------------------------------- list --------------------------------- */

  static async list(merchantId: string, q: OrderQuery) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = [eq(orders.merchantId, merchantId)]

    if (q.status) conditions.push(eq(orders.status, q.status))
    if (q.paymentStatus) conditions.push(eq(orders.paymentStatus, q.paymentStatus))
    if (q.customerId) conditions.push(eq(orders.customerId, q.customerId))
    if (q.dateFrom) conditions.push(gte(orders.createdAt, new Date(q.dateFrom)))
    if (q.dateTo) conditions.push(lte(orders.createdAt, new Date(q.dateTo)))
    if (q.search) {
      const s = `%${q.search.trim()}%`
      const cond = or(
        ilike(orders.orderNumber, s),
        ilike(sql`coalesce(${customers.firstName},'')`, s),
        ilike(sql`coalesce(${customers.lastName},'')`, s),
        ilike(sql`coalesce(${customers.email},'')`, s)
      )
      if (cond) conditions.push(cond)
    }

    const where = and(...conditions)

    const [{ total }] = await db
      .select({ total: count() })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)

    const rows = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        fulfillmentStatus: orders.fulfillmentStatus,
        total: orders.total,
        subtotal: orders.subtotal,
        discountTotal: orders.discountTotal,
        shippingTotal: orders.shippingTotal,
        taxTotal: orders.taxTotal,
        currency: orders.currency,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customerId: orders.customerId,
        customerName: sql<string>`concat_ws(' ', ${customers.firstName}, ${customers.lastName})`,
        customerEmail: customers.email,
        itemCount: sql<number>`(
          select coalesce(sum(${orderItems.quantity}), 0) from ${orderItems}
          where ${orderItems.orderId} = ${orders.id}
        )`
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({ items: rows, meta: makeMeta(page, limit, Number(total)) })
  }

  /* -------------------------------- detail -------------------------------- */

  static async get(merchantId: string, id: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')

    const items = await db
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        variantId: orderItems.variantId,
        name: orderItems.name,
        sku: orderItems.sku,
        price: orderItems.price,
        quantity: orderItems.quantity,
        total: orderItems.total,
        optionValues: productVariants.optionValues
      })
      .from(orderItems)
      .leftJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .where(eq(orderItems.orderId, id))

    const [customer] = order.customerId
      ? await db
          .select(publicCustomerColumns)
          .from(customers)
          .where(eq(customers.id, order.customerId))
      : []

    const returns = await db
      .select()
      .from(returnsTable)
      .where(eq(returnsTable.orderId, id))

    const refundList = await db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, id))

    return ok({ ...order, customer: customer ?? null, items, returns, refunds: refundList })
  }

  /* ------------------------------- workflow ------------------------------- */

  static async updateStatus(
    merchantId: string,
    id: string,
    input: { status?: string; paymentStatus?: string; fulfillmentStatus?: string }
  ) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')

    // Cancellation is a domain operation (restock + coupon restore + payment
    // validation), never a plain status write. Route it through the
    // authoritative service so the generic endpoint cannot bypass side effects.
    if (input.status === 'cancelled' && order.status !== 'cancelled') {
      if (input.paymentStatus && input.paymentStatus !== order.paymentStatus) {
        throw badRequest('INVALID_TRANSITION', 'Cannot combine cancellation with a payment change')
      }
      return this.cancel(merchantId, id)
    }

    if (input.status && input.status !== order.status) {
      const allowed = TRANSITIONS[order.status as OrderStatus]
      if (!allowed.includes(input.status as OrderStatus)) {
        throw badRequest(
          'INVALID_TRANSITION',
          `Cannot move order from ${order.status} to ${input.status}`
        )
      }
    }

    const values: Partial<Order> = {}
    if (input.status) values.status = input.status as OrderStatus

    // Manual payment transitions are constrained — refunds stay in the refund
    // flow, and a refunded/cancelled order can never be flipped back to paid.
    let markPaid = false
    if (input.paymentStatus && input.paymentStatus !== order.paymentStatus) {
      const allowedPayment = PAYMENT_TRANSITIONS[order.paymentStatus] ?? []
      if (!allowedPayment.includes(input.paymentStatus)) {
        throw badRequest(
          'INVALID_TRANSITION',
          `Cannot move payment from ${order.paymentStatus} to ${input.paymentStatus}`
        )
      }
      values.paymentStatus = input.paymentStatus
      if (input.paymentStatus === 'paid') markPaid = true
    }

    if (input.fulfillmentStatus && input.fulfillmentStatus !== order.fulfillmentStatus) {
      if (['cancelled', 'refunded'].includes(order.status)) {
        throw badRequest(
          'INVALID_TRANSITION',
          `Cannot change fulfillment on a ${order.status} order`
        )
      }
      const allowedFulfillment = FULFILLMENT_TRANSITIONS[order.fulfillmentStatus] ?? []
      if (!allowedFulfillment.includes(input.fulfillmentStatus)) {
        throw badRequest(
          'INVALID_TRANSITION',
          `Cannot move fulfillment from ${order.fulfillmentStatus} to ${input.fulfillmentStatus}`
        )
      }
      values.fulfillmentStatus = input.fulfillmentStatus
    }

    if (Object.keys(values).length === 0) return ok(order)

    if (markPaid) {
      // Route the unpaid→paid flip through the shared helper so customer totals,
      // funnel metrics and emails behave exactly like gateway payments.
      const applied = await applyManualMarkPaid(
        order,
        values.status ? { status: values.status } : {}
      )
      return ok(applied)
    }

    const [updated] = await db
      .update(orders)
      .set(values)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
      .returning()

    this.dispatchOrderEvents(merchantId, updated)

    return ok(updated)
  }

  static async cancel(merchantId: string, id: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw badRequest('INVALID_TRANSITION', `Order is already ${order.status}`)
    }
    // Money has moved (or partially moved) — cancellation cannot undo a payment.
    // Refunds are the only way out of paid/partially_refunded states.
    if (['paid', 'partially_refunded', 'refunded'].includes(order.paymentStatus)) {
      throw badRequest(
        'REFUND_REQUIRED',
        'Paid orders must be refunded via the refunds flow — cancelling would lose the payment trail'
      )
    }
    // Only pre-shipment orders can be cancelled; shipped/delivered orders need returns.
    if (!['pending', 'processing'].includes(order.status)) {
      throw badRequest('INVALID_TRANSITION', `Cannot cancel a ${order.status} order`)
    }

    const applied = await db.transaction((tx) => cancelPendingOrderTx(tx, order))
    // A racing path (sweep / webhook) resolved the order first.
    if (!applied) throw badRequest('INVALID_TRANSITION', 'Order was already updated')

    const [updated] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.merchantId, merchantId)))
    emit(merchantId, 'order.cancelled', { orderId: id, orderNumber: updated.orderNumber })
    return ok(updated)
  }

  private static dispatchOrderEvents(merchantId: string, order: Order) {
    if (order.status === 'shipped') {
      emit(merchantId, 'order.shipped', { orderId: order.id, orderNumber: order.orderNumber })
    }
    if (order.status === 'delivered') {
      emit(merchantId, 'order.delivered', { orderId: order.id, orderNumber: order.orderNumber })
    }
  }

  /* ------------------------- returns / refunds ---------------------------- */

  static async createReturn(
    merchantId: string,
    input: { orderId: string; orderItemId: string; quantity: number; reason?: string }
  ) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')
    if (order.status === 'cancelled') {
      throw badRequest('BAD_REQUEST', 'Cannot return a cancelled order')
    }

    const [item] = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orderId, order.id)))
    if (!item) throw notFound('NOT_FOUND', 'Order item not found')

    // Lock the order row for the whole check+insert so two concurrent returns
    // can never reserve the same units (P1-02).
    const created = await db.transaction(async (tx) => {
      const [lockedOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, order.id))
        .for('update')
      if (lockedOrder.status === 'cancelled') {
        throw badRequest('BAD_REQUEST', 'Cannot return a cancelled order')
      }

      // Cumulative check — sum of all non-rejected/non-failed returns must not exceed purchased qty
      const [returnedRow] = await tx
        .select({ returned: sql<number>`coalesce(sum(${returnsTable.quantity}), 0)` })
        .from(returnsTable)
        .where(
          and(
            eq(returnsTable.orderItemId, item.id),
            sql`${returnsTable.status} NOT IN ('rejected', 'failed')`
          )
        )
      const alreadyReturned = Number(returnedRow?.returned ?? 0)
      const available = item.quantity - alreadyReturned
      if (input.quantity > available) {
        throw badRequest('BAD_REQUEST', `Only ${available} unit(s) available to return`)
      }

      const [row] = await tx
        .insert(returnsTable)
        .values({
          merchantId,
          orderId: order.id,
          orderItemId: item.id,
          quantity: input.quantity,
          amount: Number((item.price * input.quantity).toFixed(2)),
          reason: input.reason ?? null,
          status: 'pending'
        })
        .returning()
      return row
    })

    emit(merchantId, 'return.created', {
      returnId: created.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: created.status
    })
    return ok(created)
  }

  static async updateReturn(
    merchantId: string,
    id: string,
    input: { status: 'approved' | 'rejected' }
  ) {
    const [ret] = await db
      .select()
      .from(returnsTable)
      .where(and(eq(returnsTable.id, id), eq(returnsTable.merchantId, merchantId)))
    if (!ret) throw notFound('NOT_FOUND', 'Return not found')
    if (ret.status !== 'pending') {
      throw badRequest('RETURN_ALREADY_PROCESSED', `Return is already ${ret.status}`)
    }

    const updated = await db.transaction(async (tx) => {
      // Atomic claim: only the transaction that flips pending→approved/rejected
      // may proceed — concurrent approvals can never double-restock (P0-06).
      const [claimed] = await tx
        .update(returnsTable)
        .set({ status: input.status })
        .where(
          and(
            eq(returnsTable.id, id),
            eq(returnsTable.merchantId, merchantId),
            eq(returnsTable.status, 'pending')
          )
        )
        .returning()
      if (!claimed) {
        throw badRequest('RETURN_ALREADY_PROCESSED', 'Return was just processed by someone else')
      }

      if (input.status === 'approved' && claimed.orderItemId) {
        // A cancelled order already restored its inventory — approving a return
        // against it would restock dead stock (P1-01). Checked inside the same
        // transaction as the restock, with the order locked.
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, claimed.orderId))
          .for('update')
        if (!order || order.status === 'cancelled') {
          throw badRequest('ORDER_CANCELLED', 'Cannot approve a return on a cancelled order')
        }
        const [item] = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.id, claimed.orderItemId))
        if (item?.variantId) {
          await this.restockTx(
            tx,
            merchantId,
            [{ variantId: item.variantId, quantity: claimed.quantity }],
            'return'
          )
        }
      }

      return claimed
    })

    return ok(updated)
  }

  static async listReturns(merchantId: string, orderId?: string) {
    const conditions = [eq(returnsTable.merchantId, merchantId)]
    if (orderId) conditions.push(eq(returnsTable.orderId, orderId))
    const rows = await db
      .select({
        id: returnsTable.id,
        orderId: returnsTable.orderId,
        orderItemId: returnsTable.orderItemId,
        quantity: returnsTable.quantity,
        amount: returnsTable.amount,
        reason: returnsTable.reason,
        status: returnsTable.status,
        createdAt: returnsTable.createdAt,
        orderNumber: orders.orderNumber
      })
      .from(returnsTable)
      .innerJoin(orders, eq(returnsTable.orderId, orders.id))
      .where(and(...conditions))
      .orderBy(desc(returnsTable.createdAt))
    return ok(rows)
  }

  static async createRefund(
    merchantId: string,
    input: { orderId: string; returnId?: string; amount: number; method?: string; idempotencyKey?: string }
  ) {
    // Idempotent replay: a client retrying with the same key gets the original
    // refund back instead of creating a second external refund (P0-02).
    if (input.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(refunds)
        .where(
          and(
            eq(refunds.merchantId, merchantId),
            eq(refunds.idempotencyKey, input.idempotencyKey)
          )
        )
      if (existing) return ok(existing)
    }

    // ── tx1: reservation ────────────────────────────────────────────────
    // Lock the order, validate the refundable balance and insert a 'pending'
    // refund row that COUNTS toward the balance. Two concurrent refunds
    // serialize on the row lock — the second sees the first's reservation and
    // is rejected instead of over-refunding (P0-05).
    const reserved = await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.merchantId, merchantId)))
        .for('update')
      if (!order) throw notFound('NOT_FOUND', 'Order not found')

      // Wallet/store-credit methods need a credit ledger that doesn't exist yet.
      if (input.method && input.method !== 'original') {
        throw badRequest('REFUND_METHOD_UNAVAILABLE', `Refund method "${input.method}" is not supported`)
      }

      // Only paid orders can be refunded
      if (!['paid', 'partially_refunded'].includes(order.paymentStatus)) {
        throw badRequest('BAD_REQUEST', 'Only paid orders can be refunded')
      }

      // If a return is attached it must belong to this order
      if (input.returnId) {
        const [ret] = await tx
          .select()
          .from(returnsTable)
          .where(eq(returnsTable.id, input.returnId))
        if (!ret || ret.orderId !== order.id) {
          throw badRequest('BAD_REQUEST', 'Return does not belong to this order')
        }
      }

      const existing = await tx
        .select({ sum: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
        .from(refunds)
        .where(
          and(
            eq(refunds.orderId, order.id),
            // Failed attempts release their balance; pending rows hold it.
            sql`${refunds.status} != 'failed'`
          )
        )

      const already = Number(existing[0]?.sum ?? 0)
      if (already + input.amount > order.total + 0.001) {
        throw badRequest(
          'BAD_REQUEST',
          `Refund exceeds order balance (${(order.total - already).toFixed(2)} remaining)`
        )
      }

      const [refundRow] = await tx
        .insert(refunds)
        .values({
          merchantId,
          orderId: order.id,
          returnId: input.returnId ?? null,
          amount: input.amount,
          method: input.method ?? 'original',
          providerRef: null,
          status: 'pending',
          idempotencyKey: input.idempotencyKey ?? createId(),
          attemptCount: 1
        })
        .returning()

      return { order, refundRow }
    })

    // ── gateway call (outside any transaction) ──────────────────────────
    let gatewayRef: string | null = null
    let failureMessage: string | null = null
    try {
      if ((input.method ?? 'original') === 'original' && reserved.order.paymentProvider) {
        const [txn] = await db
          .select()
          .from(paymentTransactions)
          .where(
            and(
              eq(paymentTransactions.orderId, reserved.order.id),
              eq(paymentTransactions.provider, reserved.order.paymentProvider)
            )
          )
          .orderBy(desc(paymentTransactions.createdAt))
          .limit(1)

        const adapter =
          txn?.providerRef && ['paid', 'authorized'].includes(txn.status)
            ? getProvider(reserved.order.paymentProvider)
            : null

        if (adapter && txn) {
          const [configRow] = await db
            .select()
            .from(paymentProviderConfigs)
            .where(
              and(
                eq(paymentProviderConfigs.merchantId, merchantId),
                eq(paymentProviderConfigs.provider, reserved.order.paymentProvider)
              )
            )
          if (!configRow) {
            throw new Error(
              `Provider "${reserved.order.paymentProvider}" is no longer configured`
            )
          }
          const config = {
            providerId: reserved.order.paymentProvider,
            enabled: configRow.enabled,
            mode: (configRow.mode === 'live' ? 'live' : 'test') as 'test' | 'live',
            country: configRow.country ?? null,
            credentials: decryptJson<Record<string, string>>(configRow.credentials)
          }
          const result = await adapter.refund(config, {
            providerRef: txn.providerRef!,
            amount: input.amount,
            currency: reserved.order.currency,
            comment: `Refund for ${reserved.order.orderNumber}`
          })
          gatewayRef = result.ref
        }
      }
    } catch (e) {
      failureMessage =
        e instanceof Error ? e.message : `Gateway refund failed for ${reserved.order.orderNumber}`
    }

    // ── tx2: resolution ─────────────────────────────────────────────────
    if (failureMessage) {
      await db
        .update(refunds)
        .set({ status: 'failed', lastError: failureMessage })
        .where(eq(refunds.id, reserved.refundRow.id))
      throw badRequest('REFUND_FAILED', failureMessage)
    }

    const refund = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(refunds)
        .set({ status: 'completed', providerRef: gatewayRef })
        .where(eq(refunds.id, reserved.refundRow.id))
        .returning()

      // Completed refunds define the order's payment state — pending/failed
      // reservations never move money.
      const [sumRow] = await tx
        .select({ sum: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
        .from(refunds)
        .where(and(eq(refunds.orderId, reserved.order.id), eq(refunds.status, 'completed')))
      const totalCompleted = Number(sumRow?.sum ?? 0)
      const fullyRefunded = totalCompleted >= reserved.order.total - 0.001
      await tx
        .update(orders)
        .set({
          paymentStatus: fullyRefunded ? 'refunded' : 'partially_refunded',
          ...(fullyRefunded && reserved.order.status === 'delivered'
            ? { status: 'refunded' }
            : {})
        })
        .where(eq(orders.id, reserved.order.id))
      return row
    })

    void EmailsService.refundProcessed(merchantId, reserved.order.id, input.amount)
    emit(merchantId, 'refund.completed', {
      refundId: refund.id,
      orderId: reserved.order.id,
      orderNumber: reserved.order.orderNumber,
      amount: refund.amount
    })

    return ok(refund)
  }

  /**
   * Re-attempt a failed (or crashed-pending) refund through the gateway using
   * the SAME idempotency key, so a provider that saw the first attempt dedupes
   * instead of paying out twice. Attempt count is tracked for auditability.
   */
  static async retryRefund(merchantId: string, refundId: string) {
    const [refund] = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.id, refundId), eq(refunds.merchantId, merchantId)))
    if (!refund) throw notFound('NOT_FOUND', 'Refund not found')
    if (refund.status === 'completed') return ok(refund)
    if (refund.status !== 'failed' && refund.status !== 'pending') {
      throw badRequest('BAD_REQUEST', `Cannot retry a ${refund.status} refund`)
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, refund.orderId), eq(orders.merchantId, merchantId)))
    if (!order) throw notFound('NOT_FOUND', 'Order not found')

    let gatewayRef: string | null = null
    let failureMessage: string | null = null
    try {
      if (order.paymentProvider) {
        const [txn] = await db
          .select()
          .from(paymentTransactions)
          .where(
            and(
              eq(paymentTransactions.orderId, order.id),
              eq(paymentTransactions.provider, order.paymentProvider)
            )
          )
          .orderBy(desc(paymentTransactions.createdAt))
          .limit(1)

        const adapter =
          txn?.providerRef && ['paid', 'authorized'].includes(txn.status)
            ? getProvider(order.paymentProvider)
            : null

        if (adapter && txn) {
          const [configRow] = await db
            .select()
            .from(paymentProviderConfigs)
            .where(
              and(
                eq(paymentProviderConfigs.merchantId, merchantId),
                eq(paymentProviderConfigs.provider, order.paymentProvider)
              )
            )
          if (!configRow) throw new Error(`Provider "${order.paymentProvider}" is no longer configured`)
          const config = {
            providerId: order.paymentProvider,
            enabled: configRow.enabled,
            mode: (configRow.mode === 'live' ? 'live' : 'test') as 'test' | 'live',
            country: configRow.country ?? null,
            credentials: decryptJson<Record<string, string>>(configRow.credentials)
          }
          const result = await adapter.refund(config, {
            providerRef: txn.providerRef!,
            amount: Number(refund.amount),
            currency: order.currency,
            comment: `Retry refund for ${order.orderNumber}`
          })
          gatewayRef = result.ref
        }
      }
    } catch (e) {
      failureMessage = e instanceof Error ? e.message : 'Gateway refund retry failed'
    }

    if (failureMessage) {
      const [row] = await db
        .update(refunds)
        .set({
          status: 'failed',
          lastError: failureMessage,
          attemptCount: sql`${refunds.attemptCount} + 1`
        })
        .where(eq(refunds.id, refund.id))
        .returning()
      throw badRequest('REFUND_FAILED', `${failureMessage} (attempt ${row.attemptCount})`)
    }

    // Completed — recompute the order aggregate exactly like a fresh refund.
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(refunds)
        .set({
          status: 'completed',
          providerRef: gatewayRef,
          lastError: null,
          attemptCount: sql`${refunds.attemptCount} + 1`
        })
        .where(eq(refunds.id, refund.id))
        .returning()

      const [sumRow] = await tx
        .select({ sum: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
        .from(refunds)
        .where(and(eq(refunds.orderId, order.id), eq(refunds.status, 'completed')))
      const totalCompleted = Number(sumRow?.sum ?? 0)
      const fullyRefunded = totalCompleted >= order.total - 0.001
      await tx
        .update(orders)
        .set({
          paymentStatus: fullyRefunded ? 'refunded' : 'partially_refunded',
          ...(fullyRefunded && order.status === 'delivered' ? { status: 'refunded' } : {})
        })
        .where(eq(orders.id, order.id))

      void EmailsService.refundProcessed(merchantId, order.id, Number(refund.amount))
      return ok(row)
    })
  }

  /**
   * Crash-reconciliation sweep: a refund stuck in 'pending' long past any
   * plausible gateway timeout means the process died between the reservation
   * and the resolution transaction. Release the reservation (mark failed) so
   * the balance becomes refundable again — the retry endpoint can still push
   * it through with the same idempotency key.
   */
  static async reconcileStaleRefunds() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const released = await db
      .update(refunds)
      .set({ status: 'failed', lastError: 'reconciliation timeout — pending for over 24h' })
      .where(and(eq(refunds.status, 'pending'), lte(refunds.createdAt, cutoff)))
      .returning({ id: refunds.id })
    if (released.length > 0) {
      console.log(`[refunds] reconciliation released ${released.length} stale pending refund(s)`)
    }
  }

  static async listRefunds(merchantId: string, orderId?: string) {
    const conditions = [eq(refunds.merchantId, merchantId)]
    if (orderId) conditions.push(eq(refunds.orderId, orderId))
    const rows = await db
      .select({
        id: refunds.id,
        orderId: refunds.orderId,
        returnId: refunds.returnId,
        amount: refunds.amount,
        method: refunds.method,
        status: refunds.status,
        createdAt: refunds.createdAt,
        orderNumber: orders.orderNumber
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .where(and(...conditions))
      .orderBy(desc(refunds.createdAt))
    return ok(rows)
  }

  /* -------------------------------- helpers ------------------------------- */

  private static async restockTx(
    tx: any,
    merchantId: string,
    items: Array<{ variantId: string; quantity: number }>,
    reason: string
  ) {
    for (const { variantId, quantity } of items) {
      // Locked + relative increment — an absolute SET from a stale read loses
      // concurrent sales (the checkout decrement uses the same lock).
      const [v] = await tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .for('update')
      if (!v) continue
      const afterValue = v.inventory + quantity
      await tx
        .update(productVariants)
        .set({ inventory: afterValue })
        .where(eq(productVariants.id, variantId))
      await tx.insert(inventoryLogs).values({
        merchantId,
        variantId,
        change: quantity,
        beforeValue: v.inventory,
        afterValue,
        reason,
        reference: 'order'
      })
    }
  }
}