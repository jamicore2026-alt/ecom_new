import { t } from 'elysia'

export const platformLoginBody = t.Object({
  email: t.String({ format: 'email', minLength: 3, maxLength: 255 }),
  password: t.String({ minLength: 1, maxLength: 255 })
})

export const platformStatusBody = t.Object({
  to: t.String({ minLength: 1, maxLength: 20 }),
  reason: t.String({ minLength: 3, maxLength: 500 })
})

export const platformListQuery = t.Object({
  status: t.Optional(t.String({ maxLength: 20 })),
  search: t.Optional(t.String({ maxLength: 255 })),
  page: t.Optional(t.String()),
  limit: t.Optional(t.String())
})

export const platformIdParams = t.Object({ id: t.String({ minLength: 1 }) })

export const platformCreateMerchantBody = t.Object({
  name: t.String({ minLength: 2, maxLength: 255 }),
  slug: t.String({ minLength: 2, maxLength: 100, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  email: t.String({ format: 'email', maxLength: 255 }),
  phone: t.Optional(t.String({ maxLength: 50 })),
  currency: t.Optional(t.String({ minLength: 1, maxLength: 10 })),
  timezone: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  country: t.Optional(t.String({ minLength: 2, maxLength: 3 })),
  owner: t.Object({
    name: t.String({ minLength: 2, maxLength: 255 }),
    email: t.String({ format: 'email', maxLength: 255 }),
    password: t.String({ minLength: 10, maxLength: 72 })
  })
})