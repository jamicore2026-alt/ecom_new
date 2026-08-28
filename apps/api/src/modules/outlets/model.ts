import { t } from 'elysia'

const addressSchema = t.Object({
  name: t.Optional(t.String()),
  line1: t.Optional(t.String()),
  line2: t.Optional(t.String()),
  city: t.Optional(t.String()),
  state: t.Optional(t.String()),
  postalCode: t.Optional(t.String()),
  country: t.Optional(t.String()),
  phone: t.Optional(t.String())
})

export const outletStatusSchema = t.Enum({ active: 'active', inactive: 'inactive', archived: 'archived' })

export const createOutletBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  code: t.String({ minLength: 1, maxLength: 50 }),
  address: t.Optional(addressSchema),
  status: t.Optional(outletStatusSchema)
})

export const updateOutletBody = t.Partial(
  t.Object({
    name: t.String({ minLength: 1, maxLength: 255 }),
    code: t.String({ minLength: 1, maxLength: 50 }),
    address: t.Optional(addressSchema),
    status: t.Optional(outletStatusSchema)
  })
)

export const outletParams = t.Object({ outletId: t.String() })

export const setIdParams = t.Object({ id: t.String() })
