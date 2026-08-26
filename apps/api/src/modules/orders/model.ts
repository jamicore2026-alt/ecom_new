import { t } from 'elysia'

export const orderStatusSchema = t.Enum({
  pending: 'pending',
  processing: 'processing',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  refunded: 'refunded'
})

export const paymentStatusSchema = t.Enum({
  unpaid: 'unpaid',
  paid: 'paid',
  partially_refunded: 'partially_refunded',
  refunded: 'refunded',
  failed: 'failed'
})

export const fulfillmentStatusSchema = t.Enum({
  unfulfilled: 'unfulfilled',
  fulfilled: 'fulfilled'
})

export const returnStatusSchema = t.Enum({
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  restocked: 'restocked'
})

export const refundMethodSchema = t.Enum({
  original: 'original'
})

export const updateStatusBody = t.Object({
  status: t.Optional(orderStatusSchema),
  paymentStatus: t.Optional(paymentStatusSchema),
  fulfillmentStatus: t.Optional(fulfillmentStatusSchema)
})

export const createReturnBody = t.Object({
  orderId: t.String({ minLength: 1 }),
  orderItemId: t.String({ minLength: 1 }),
  quantity: t.Integer({ minimum: 1 }),
  reason: t.Optional(t.String())
})

export const updateReturnBody = t.Object({
  status: t.Enum({ approved: 'approved', rejected: 'rejected' })
})

export const createRefundBody = t.Object({
  orderId: t.String({ minLength: 1 }),
  returnId: t.Optional(t.String()),
  amount: t.Number({ minimum: 0.01 }),
  method: t.Optional(refundMethodSchema),
  // Client-supplied key for safe retries — same key never double-refunds.
  idempotencyKey: t.Optional(t.String({ maxLength: 80 }))
})

export const orderQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  status: t.Optional(orderStatusSchema),
  paymentStatus: t.Optional(paymentStatusSchema),
  customerId: t.Optional(t.String()),
  dateFrom: t.Optional(t.String()),
  dateTo: t.Optional(t.String()),
  search: t.Optional(t.String())
})
