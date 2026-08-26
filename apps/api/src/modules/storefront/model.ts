import { t } from 'elysia'

export const storefrontQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  search: t.Optional(t.String()),
  category: t.Optional(t.String()),
  categoryId: t.Optional(t.String()),
  minPrice: t.Optional(t.String()),
  maxPrice: t.Optional(t.String()),
  sort: t.Optional(t.Enum({ price_asc: 'price_asc', price_desc: 'price_desc', newest: 'newest' }))
})

export const storeParams = t.Object({
  slug: t.String()
})

export const productSlugParams = t.Object({
  slug: t.String(),
  productSlug: t.String()
})

export const productReviewsQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String())
})

const checkoutItem = t.Object({
  productId: t.String({ maxLength: 30 }),
  variantId: t.String({ maxLength: 30 }),
  quantity: t.Integer({ minimum: 1, maximum: 99 })
})

export const addressBody = t.Object({
  name: t.Optional(t.String({ maxLength: 255 })),
  line1: t.Optional(t.String({ maxLength: 255 })),
  line2: t.Optional(t.String({ maxLength: 255 })),
  city: t.Optional(t.String({ maxLength: 100 })),
  state: t.Optional(t.String({ maxLength: 100 })),
  postalCode: t.Optional(t.String({ maxLength: 20 })),
  country: t.Optional(t.String({ maxLength: 2 })),
  phone: t.Optional(t.String({ maxLength: 30 }))
})

export const checkoutPreviewBody = t.Object({
  items: t.Array(checkoutItem, { minItems: 1, maxItems: 50 }),
  couponCode: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  // Declared so the preview contract matches final checkout — the storefront
  // re-previews on country change to quote shipping/tax for the real destination.
  shippingAddress: t.Optional(addressBody)
})

export const checkoutBody = t.Object({
  items: t.Array(checkoutItem, { minItems: 1, maxItems: 50 }),
  couponCode: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  email: t.String({ format: 'email', maxLength: 255 }),
  shippingAddress: addressBody,
  billingAddress: t.Optional(addressBody),
  paymentMethod: t.String({ maxLength: 50 }),
  notes: t.Optional(t.String({ maxLength: 2000 }))
})

export const orderParams = t.Object({
  slug: t.String(),
  orderNumber: t.String()
})

export const syncOrderBody = t.Object({
  paymentId: t.Optional(t.String())
})

export const trackEventBody = t.Object({
  type: t.Union([t.Literal('view'), t.Literal('cart_add'), t.Literal('checkout_start')]),
  channel: t.Optional(t.String({ maxLength: 20 }))
})
