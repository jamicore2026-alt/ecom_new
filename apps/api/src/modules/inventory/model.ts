import { t } from 'elysia'

export const adjustBody = t.Object({
  change: t.Integer(),
  reason: t.Enum({
    adjustment: 'adjustment',
    purchase: 'purchase',
    return: 'return',
    sale: 'sale'
  })
})

export const inventoryQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  search: t.Optional(t.String()),
  status: t.Optional(t.Enum({ active: 'active', draft: 'draft', archived: 'archived' }))
})

export const historyQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  variantId: t.Optional(t.String()),
  productId: t.Optional(t.String()),
  dateFrom: t.Optional(t.String()),
  dateTo: t.Optional(t.String())
})
