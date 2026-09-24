import { t } from 'elysia'

export const productStatusSchema = t.Enum({ active: 'active', draft: 'draft', archived: 'archived' })
export const categoryStatusSchema = t.Enum({ active: 'active', archived: 'archived' })
export const productVisibilitySchema = t.Enum({ both: 'both', pos: 'pos', website: 'website' })

export const variantInput = t.Object({
  sku: t.Optional(t.String()),
  optionValues: t.Optional(t.Record(t.String(), t.String())),
  optionValuesAr: t.Optional(t.Record(t.String(), t.String())),
  price: t.Optional(t.Number({ minimum: 0 })),
  compareAtPrice: t.Optional(t.Number({ minimum: 0 })),
  inventory: t.Optional(t.Integer()),
  unlimited: t.Optional(t.Boolean()),
  image: t.Optional(t.String())
})

export const productOptionValueInput = t.Object({
  value: t.String({ minLength: 1, maxLength: 100 }),
  valueAr: t.Optional(t.String({ maxLength: 100 })),
  priceAdjustment: t.Optional(t.Number()),
  quantity: t.Optional(t.Integer({ minimum: 0 })),
  meta: t.Optional(t.Record(t.String(), t.String())),
  sortOrder: t.Optional(t.Integer({ minimum: 0 })),
  status: t.Optional(t.String())
})

export const productOptionInput = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
  nameAr: t.Optional(t.String({ maxLength: 100 })),
  type: t.Optional(t.Enum({ radio: 'radio', checkbox: 'checkbox', select: 'select', swatch: 'swatch', number: 'number', text: 'text' })),
  required: t.Optional(t.Boolean()),
  minSelections: t.Optional(t.Integer({ minimum: 0 })),
  maxSelections: t.Optional(t.Integer({ minimum: 1 })),
  perValueQuantity: t.Optional(t.Boolean()),
  unlimited: t.Optional(t.Boolean()),
  sortOrder: t.Optional(t.Integer({ minimum: 0 })),
  status: t.Optional(t.String()),
  values: t.Optional(t.Array(productOptionValueInput))
})

export const saveOptionsBody = t.Object({
  options: t.Array(productOptionInput)
})

export const productImageInput = t.Object({
  url: t.String({ minLength: 1, maxLength: 1024 }),
  altText: t.Optional(t.String({ maxLength: 255 })),
  sortOrder: t.Optional(t.Integer({ minimum: 0 }))
})

export const createProductBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  nameAr: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  sku: t.Optional(t.String()),
  barcode: t.Optional(t.String()),
  slug: t.Optional(t.String()),
  description: t.Optional(t.String()),
  descriptionAr: t.Optional(t.String()),
  price: t.Number({ minimum: 0 }),
  compareAtPrice: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  cost: t.Optional(t.Number({ minimum: 0 })),
  categoryId: t.Optional(t.Union([t.String(), t.Null()])),
  trackInventory: t.Optional(t.Boolean()),
  lowStockThreshold: t.Optional(t.Integer({ minimum: 0 })),
  status: t.Optional(productStatusSchema),
  visibility: t.Optional(productVisibilitySchema),
  tags: t.Optional(t.Array(t.String())),
  weight: t.Optional(t.Union([t.Number(), t.Null()])),
  gtin: t.Optional(t.Union([t.String({ maxLength: 32 }), t.Null()])),
  metaTitle: t.Optional(t.Union([t.String({ maxLength: 255 }), t.Null()])),
  metaDescription: t.Optional(t.Union([t.String(), t.Null()])),
  saleStartsAt: t.Optional(t.Union([t.String(), t.Null()])),
  saleEndsAt: t.Optional(t.Union([t.String(), t.Null()])),
  publishAt: t.Optional(t.Union([t.String(), t.Null()])),
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
    set_inventory: 'set_inventory',
    set_visibility: 'set_visibility',
    set_compare_at: 'set_compare_at',
    clear_sale: 'clear_sale'
  }),
  value: t.Union([t.String(), t.Number(), t.Null()])
})

export const categoryBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  nameAr: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  slug: t.Optional(t.String()),
  parentId: t.Optional(t.Union([t.String(), t.Null()])),
  image: t.Optional(t.Union([t.String(), t.Null()])),
  description: t.Optional(t.Union([t.String(), t.Null()])),
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
