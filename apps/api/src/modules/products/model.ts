import { t } from 'elysia'

export const productStatusSchema = t.Enum({ active: 'active', draft: 'draft', archived: 'archived' })
export const categoryStatusSchema = t.Enum({ active: 'active', archived: 'archived' })

export const variantInput = t.Object({
  sku: t.Optional(t.String()),
  optionValues: t.Optional(t.Record(t.String(), t.String())),
  price: t.Optional(t.Number({ minimum: 0 })),
  compareAtPrice: t.Optional(t.Number({ minimum: 0 })),
  inventory: t.Optional(t.Integer()),
  image: t.Optional(t.String())
})

export const productImageInput = t.Object({
  url: t.String({ minLength: 1, maxLength: 1024 }),
  altText: t.Optional(t.String({ maxLength: 255 })),
  sortOrder: t.Optional(t.Integer({ minimum: 0 }))
})

export const createProductBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  sku: t.Optional(t.String()),
  barcode: t.Optional(t.String()),
  slug: t.Optional(t.String()),
  description: t.Optional(t.String()),
  price: t.Number({ minimum: 0 }),
  compareAtPrice: t.Optional(t.Number({ minimum: 0 })),
  cost: t.Optional(t.Number({ minimum: 0 })),
  categoryId: t.Optional(t.String()),
  trackInventory: t.Optional(t.Boolean()),
  lowStockThreshold: t.Optional(t.Integer({ minimum: 0 })),
  status: t.Optional(productStatusSchema),
  variants: t.Optional(t.Array(variantInput)),
  images: t.Optional(t.Array(productImageInput))
})

export const updateProductBody = t.Partial(t.Omit(createProductBody, ['variants']))

export const bulkEditBody = t.Object({
  ids: t.Array(t.String(), { minItems: 1 }),
  action: t.Enum({
    set_status: 'set_status',
    set_category: 'set_category',
    multiply_price: 'multiply_price',
    set_inventory: 'set_inventory'
  }),
  value: t.Union([t.String(), t.Number(), t.Null()])
})

export const categoryBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  slug: t.Optional(t.String()),
  parentId: t.Optional(t.Union([t.String(), t.Null()])),
  image: t.Optional(t.String()),
  sortOrder: t.Optional(t.Integer()),
  status: t.Optional(categoryStatusSchema)
})

export const productQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  search: t.Optional(t.String()),
  status: t.Optional(productStatusSchema),
  categoryId: t.Optional(t.String()),
  minPrice: t.Optional(t.String()),
  maxPrice: t.Optional(t.String()),
  lowStock: t.Optional(t.Enum({ true: 'true', '1': '1' }))
})

export const variantParams = t.Object({
  id: t.String()
})

export const importCsvBody = t.Object({
  // NOTE: no MIME whitelist — Elysia validates t.File types via magic-byte
  // sniffing, which plain text CSVs can never satisfy. Content is parsed as text.
  file: t.File()
})
