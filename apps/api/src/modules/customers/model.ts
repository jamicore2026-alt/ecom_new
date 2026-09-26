import { t } from 'elysia'

export const customerQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  search: t.Optional(t.String()),
  tag: t.Optional(t.String()),
  sortBy: t.Optional(
    t.Enum({ total_spent: 'total_spent', orders_count: 'orders_count', created_at: 'created_at' })
  ),
  sortOrder: t.Optional(t.Enum({ asc: 'asc', desc: 'desc' }))
})

export const customerCreateBody = t.Object({
  email: t.String({ format: 'email', maxLength: 255 }),
  firstName: t.Optional(t.String({ maxLength: 255 })),
  lastName: t.Optional(t.String({ maxLength: 255 })),
  phone: t.Optional(t.String({ maxLength: 50 })),
  tags: t.Optional(t.Array(t.String({ maxLength: 100 }))),
  marketingOptOut: t.Optional(t.Boolean())
})

export const customerUpdateBody = t.Partial(customerCreateBody)

export const customerOptOutBody = t.Object({
  marketingOptOut: t.Boolean()
})

export const importCsvBody = t.Object({
  // NOTE: no MIME whitelist — Elysia validates t.File types via magic-byte
  // sniffing, which plain text CSVs can never satisfy. Content is parsed as text.
  file: t.File()
})
