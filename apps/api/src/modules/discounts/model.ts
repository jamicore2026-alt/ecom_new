import { t } from 'elysia'

export const couponBody = t.Object({
  code: t.String({ minLength: 2, maxLength: 100 }),
  type: t.Enum({ percentage: 'percentage', fixed: 'fixed', free_shipping: 'free_shipping' }),
  value: t.Number({ minimum: 0, maximum: 1000000 }),
  minSubtotal: t.Optional(t.Number({ minimum: 0 })),
  usageLimit: t.Optional(t.Integer({ minimum: 1 })),
  startsAt: t.Optional(t.String()),
  endsAt: t.Optional(t.String()),
  status: t.Optional(t.Enum({ active: 'active', disabled: 'disabled' }))
})

export const couponUpdateBody = t.Partial(t.Omit(couponBody, ['code']))

export const couponQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  search: t.Optional(t.String()),
  status: t.Optional(t.Enum({ active: 'active', disabled: 'disabled' }))
})

export const promotionBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  type: t.Enum({ discount_on_products: 'discount_on_products', buy_x_get_y: 'buy_x_get_y' }),
  discountPercent: t.Number({ minimum: 0, maximum: 100 }),
  buyQty: t.Optional(t.Integer({ minimum: 1 })),
  getQty: t.Optional(t.Integer({ minimum: 1 })),
  appliesTo: t.Optional(
    t.Object({
      scope: t.Enum({ all: 'all', products: 'products', category: 'category' }),
      productIds: t.Optional(t.Array(t.String())),
      categoryId: t.Optional(t.String())
    })
  ),
  startsAt: t.Optional(t.String()),
  endsAt: t.Optional(t.String()),
  usageLimit: t.Optional(t.Union([t.Integer({ minimum: 1 }), t.Null()])),
  status: t.Optional(t.Enum({ active: 'active', disabled: 'disabled' }))
})

export const promotionUpdateBody = t.Partial(promotionBody)
