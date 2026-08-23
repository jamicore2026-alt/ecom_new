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

const checkoutItem = t.Object({
  productId: t.String(),
  variantId: t.String(),
  quantity: t.Integer({ minimum: 1, maximum: 99 })
})

export const checkoutPreviewBody = t.Object({
  items: t.Array(checkoutItem, { minItems: 1 }),
  couponCode: t.Optional(t.String())
})

export const addressBody = t.Object({
  name: t.Optional(t.String()),
  line1: t.Optional(t.String()),
  line2: t.Optional(t.String()),
  city: t.Optional(t.String()),
  state: t.Optional(t.String()),
  postalCode: t.Optional(t.String()),
  country: t.Optional(t.String()),
  phone: t.Optional(t.String())
})

export const checkoutBody = t.Object({
  items: t.Array(checkoutItem, { minItems: 1 }),
  couponCode: t.Optional(t.String()),
  email: t.String(),
  shippingAddress: addressBody,
  billingAddress: t.Optional(addressBody),
  paymentMethod: t.String(),
  notes: t.Optional(t.String())
})

export const orderParams = t.Object({
  slug: t.String(),
  orderNumber: t.String()
})

export const syncOrderBody = t.Object({
  paymentId: t.Optional(t.String())
})
