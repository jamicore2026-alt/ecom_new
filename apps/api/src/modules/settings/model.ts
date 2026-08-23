import { t } from 'elysia'

export const addressSchema = t.Object({
  name: t.Optional(t.String()),
  line1: t.Optional(t.String()),
  line2: t.Optional(t.String()),
  city: t.Optional(t.String()),
  state: t.Optional(t.String()),
  postalCode: t.Optional(t.String()),
  country: t.Optional(t.String()),
  phone: t.Optional(t.String())
})

export const storeBody = t.Object({
  name: t.String({ minLength: 1 }),
  logo: t.Optional(t.String()),
  address: t.Optional(addressSchema),
  currency: t.Optional(t.String({ minLength: 3, maxLength: 10 })),
  timezone: t.Optional(t.String()),
  announcement: t.Optional(t.String())
})

export const paymentBody = t.Object({
  methods: t.Optional(
    t.Array(
      t.Object({
        id: t.String(),
        label: t.String(),
        enabled: t.Boolean()
      })
    )
  ),
  currency: t.Optional(t.String({ minLength: 3, maxLength: 10 }))
})

export const providerParams = t.Object({ provider: t.String() })

export const providerBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  mode: t.Optional(t.Union([t.Literal('test'), t.Literal('live')])),
  country: t.Optional(t.Nullable(t.String({ minLength: 2, maxLength: 5 }))),
  credentials: t.Optional(t.Record(t.String(), t.Nullable(t.String())))
})

export const shippingBody = t.Object({
  zones: t.Optional(
    t.Array(
      t.Object({
        name: t.String(),
        countries: t.Array(t.String()),
        rate: t.Number({ minimum: 0 }),
        freeAbove: t.Optional(t.Number({ minimum: 0 }))
      })
    )
  ),
  freeShippingThreshold: t.Optional(t.Number({ minimum: 0 }))
})

export const taxBody = t.Object({
  autoCalculate: t.Optional(t.Boolean()),
  rates: t.Optional(
    t.Array(
      t.Object({
        region: t.String(),
        rate: t.Number({ minimum: 0, maximum: 100 })
      })
    )
  )
})

export const staffCreateBody = t.Object({
  name: t.String({ minLength: 1 }),
  email: t.String({ format: 'email' }),
  password: t.String({ minLength: 6 }),
  role: t.Enum({ admin: 'admin', staff: 'staff' }),
  permissions: t.Optional(t.Array(t.String()))
})

export const staffUpdateBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  email: t.Optional(t.String({ format: 'email' })),
  password: t.Optional(t.String({ minLength: 6 })),
  role: t.Optional(t.Enum({ owner: 'owner', admin: 'admin', staff: 'staff' })),
  permissions: t.Optional(t.Array(t.String())),
  status: t.Optional(t.Enum({ active: 'active', disabled: 'disabled' }))
})
