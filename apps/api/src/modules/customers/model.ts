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

export const importCsvBody = t.Object({
  // NOTE: no MIME whitelist — Elysia validates t.File types via magic-byte
  // sniffing, which plain text CSVs can never satisfy. Content is parsed as text.
  file: t.File()
})
