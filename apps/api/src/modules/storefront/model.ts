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
