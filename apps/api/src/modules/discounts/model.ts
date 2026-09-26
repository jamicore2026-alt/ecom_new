import { t } from 'elysia'

const couponScope = t.Object({
  scope: t.Enum({ all: 'all', products: 'products', category: 'category', customers: 'customers' }),
  productIds: t.Optional(t.Array(t.String())),
  categoryId: t.Optional(t.String()),
  customerIds: t.Optional(t.Array(t.String()))
})

export const couponBody = t.Object({
  code: t.String({ minLength: 2, maxLength: 100 }),
  type: t.Enum({ percentage: 'percentage', fixed: 'fixed', free_shipping: 'free_shipping' }),
  value: t.Number({ minimum: 0, maximum: 1000000 }),
  minSubtotal: t.Optional(t.Number({ minimum: 0 })),
  usageLimit: t.Optional(t.Integer({ minimum: 1 })),
  startsAt: t.Optional(t.String()),
  endsAt: t.Optional(t.String()),
  status: t.Optional(t.Enum({ active: 'active', disabled: 'disabled' })),
  appliesTo: t.Optional(couponScope),
  perCustomerLimit: t.Optional(t.Union([t.Integer({ minimum: 1 }), t.Null()])),
  firstOrderOnly: t.Optional(t.Boolean()),
  stackable: t.Optional(t.Boolean()),
  priority: t.Optional(t.Integer({ minimum: 0 }))
})

export const couponUpdateBody = t.Partial(t.Omit(couponBody, ['code']))

export const couponBulkBody = t.Object({
  prefix: t.String({ minLength: 1, maxLength: 20 }),
  count: t.Integer({ minimum: 1, maximum: 500 }),
  type: t.Optional(t.Enum({ percentage: 'percentage', fixed: 'fixed', free_shipping: 'free_shipping' })),
  value: t.Optional(t.Number({ minimum: 0, maximum: 1000000 })),
  minSubtotal: t.Optional(t.Number({ minimum: 0 })),
  usageLimit: t.Optional(t.Integer({ minimum: 1 })),
  startsAt: t.Optional(t.String()),
  endsAt: t.Optional(t.String()),
  appliesTo: t.Optional(couponScope),
  perCustomerLimit: t.Optional(t.Union([t.Integer({ minimum: 1 }), t.Null()])),
  firstOrderOnly: t.Optional(t.Boolean()),
  stackable: t.Optional(t.Boolean()),
  priority: t.Optional(t.Integer({ minimum: 0 }))
})

export const couponValidateBody = t.Object({
  code: t.String({ minLength: 1 }),
  subtotal: t.Number({ minimum: 0 }),
  currency: t.Optional(t.String()),
  customerId: t.Optional(t.String()),
  customerEmail: t.Optional(t.String()),
  lines: t.Optional(
    t.Array(
      t.Object({
        productId: t.String(),
        categoryId: t.Optional(t.Union([t.String(), t.Null()])),
        price: t.Number(),
        quantity: t.Integer({ minimum: 1 })
      })
    )
  ),
  promotionDiscount: t.Optional(t.Number({ minimum: 0 }))
})

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
