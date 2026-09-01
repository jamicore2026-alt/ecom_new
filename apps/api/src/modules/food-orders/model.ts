import { t } from 'elysia'

export const foodOrderItemInput = t.Object({
  menuItemId: t.String(),
  quantity: t.Number({ minimum: 1, maximum: 999 }),
  modifiers: t.Optional(
    t.Array(
      t.Object({
        modifierId: t.String(),
        quantity: t.Optional(t.Number({ minimum: 1, maximum: 99 }))
      })
    )
  )
})

export const foodOrderCreateBody = t.Object({
  orderType: t.Enum({
    DINE_IN: 'DINE_IN',
    TAKEAWAY: 'TAKEAWAY',
    DELIVERY: 'DELIVERY',
    QR: 'QR',
    POS: 'POS',
    SCHEDULED: 'SCHEDULED'
  }),
  outletId: t.String(),
  items: t.Array(foodOrderItemInput, { minItems: 1 }),
  notes: t.Optional(t.String({ maxLength: 2000 })),
  scheduledFor: t.Optional(t.String()),
  customerName: t.Optional(t.String({ maxLength: 120 })),
  customerPhone: t.Optional(t.String({ maxLength: 30 })),
  idempotencyKey: t.Optional(t.String({ maxLength: 80 }))
})

export const foodOrderUpdateBody = t.Partial(
  t.Object({
    items: t.Array(foodOrderItemInput, { minItems: 1 }),
    notes: t.Optional(t.String({ maxLength: 2000 })),
    scheduledFor: t.Optional(t.String())
  })
)

export const foodOrderStatusBody = t.Object({
  status: t.Enum({
    CREATED: 'CREATED',
    CONFIRMED: 'CONFIRMED',
    PREPARING: 'PREPARING',
    READY: 'READY',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED'
  })
})

/** POS payment capture — only the payment method is client-supplied; money totals stay server-computed. */
export const foodOrderPayBody = t.Object({
  paymentMethod: t.Optional(t.String({ maxLength: 50 }))
})

export const foodOrderParams = t.Object({ id: t.String() })

export const foodOrderQuery = t.Object({
  orderType: t.Optional(t.String()),
  status: t.Optional(t.String()),
  outletId: t.Optional(t.String()),
  search: t.Optional(t.String()),
  page: t.Optional(t.Number()),
  limit: t.Optional(t.Number())
})
