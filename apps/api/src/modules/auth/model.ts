import { t } from 'elysia'

export const loginBody = t.Object({
  email: t.String({ format: 'email' }),
  password: t.String({ minLength: 6 }),
  merchantSlug: t.Optional(t.String())
})

export const refreshBody = t.Object({
  refreshToken: t.Optional(t.String())
})

export const logoutBody = t.Object({
  refreshToken: t.Optional(t.String())
})

export const authUser = t.Object({
  id: t.String(),
  name: t.String(),
  email: t.String(),
  role: t.String(),
  permissions: t.Array(t.String()),
  status: t.String()
})

export const authMerchant = t.Object({
  id: t.String(),
  name: t.String(),
  slug: t.String(),
  currency: t.String()
})

const settings = t.Object({
  merchantId: t.String(),
  name: t.String(),
  logo: t.Union([t.String(), t.Null()]),
  address: t.Unknown(),
  currency: t.String(),
  timezone: t.String(),
  announcement: t.String(),
  updatedAt: t.Unknown()
})

export const tokenPair = t.Object({
  success: t.Boolean(),
  data: t.Object({
    accessToken: t.String(),
    refreshToken: t.String(),
    expiresIn: t.Number(),
    user: authUser,
    merchant: authMerchant
  })
})

export const meResponse = t.Object({
  success: t.Boolean(),
  data: t.Object({
    user: authUser,
    merchant: authMerchant,
    settings: t.Union([settings, t.Null()])
  })
})