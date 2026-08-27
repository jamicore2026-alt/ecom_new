import { t } from 'elysia'

export const fulfillmentParams = t.Object({
  id: t.String()
})

export const orderParams = t.Object({
  orderId: t.String()
})

export const createFulfillmentBody = t.Object({
  orderId: t.String(),
  carrier: t.Optional(t.String({ maxLength: 100 })),
  courierProvider: t.Optional(t.String({ maxLength: 50 })),
  metadata: t.Optional(t.Record(t.String(), t.Any()))
})

export const updateFulfillmentBody = t.Object({
  status: t.Optional(
    t.Union([
      t.Literal('unfulfilled'),
      t.Literal('processing'),
      t.Literal('packed'),
      t.Literal('shipped'),
      t.Literal('delivered'),
      t.Literal('failed'),
      t.Literal('returned'),
      t.Literal('cancelled')
    ])
  ),
  carrier: t.Optional(t.String({ maxLength: 100 })),
  courierProvider: t.Optional(t.String({ maxLength: 50 })),
  trackingNumber: t.Optional(t.String({ maxLength: 255 })),
  trackingUrl: t.Optional(t.String({ maxLength: 1024 })),
  labelUrl: t.Optional(t.String({ maxLength: 1024 })),
  metadata: t.Optional(t.Record(t.String(), t.Any()))
})

export const markShippedBody = t.Object({
  trackingNumber: t.Optional(t.String({ maxLength: 255 })),
  trackingUrl: t.Optional(t.String({ maxLength: 1024 })),
  labelUrl: t.Optional(t.String({ maxLength: 1024 })),
  carrier: t.Optional(t.String({ maxLength: 100 }))
})

export const fulfillmentQuery = t.Object({
  status: t.Optional(t.String()),
  orderId: t.Optional(t.String()),
  page: t.Optional(t.String()),
  limit: t.Optional(t.String())
})
