import { t } from 'elysia'

export const storeParams = t.Object({
  slug: t.String()
})

export const registerBody = t.Object({
  email: t.String({ format: 'email', maxLength: 255 }),
  password: t.String({ minLength: 8, maxLength: 72 }),
  firstName: t.Optional(t.String({ maxLength: 255 })),
  lastName: t.Optional(t.String({ maxLength: 255 })),
  /** Required when claiming an existing guest account — proof of mailbox ownership. */
  orderNumber: t.Optional(t.String({ maxLength: 50 }))
})

export const changePasswordBody = t.Object({
  currentPassword: t.String({ minLength: 1, maxLength: 72 }),
  newPassword: t.String({ minLength: 8, maxLength: 72 })
})

export const loginBody = t.Object({
  email: t.String({ format: 'email', maxLength: 255 }),
  password: t.String({ maxLength: 72 })
})

export const submitReviewBody = t.Object({
  productId: t.String(),
  rating: t.Integer({ minimum: 1, maximum: 5 }),
  title: t.Optional(t.String({ maxLength: 255 })),
  body: t.Optional(t.String({ maxLength: 5000 }))
})

export const wishlistBody = t.Object({
  productId: t.String()
})

export const wishlistParams = t.Object({
  slug: t.String(),
  productId: t.String()
})

export const shopperOrdersQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String())
})

export const forgotPasswordBody = t.Object({
  email: t.String({ format: 'email', maxLength: 255 })
})

export const resetPasswordBody = t.Object({
  token: t.String({ minLength: 1 }),
  password: t.String({ minLength: 8, maxLength: 72 })
})

export const resendVerificationBody = t.Object({
  email: t.String({ format: 'email', maxLength: 255 })
})

export const verifyEmailParams = t.Object({
  slug: t.String(),
  token: t.String()
})

export const addressBody = t.Object({
  label: t.Optional(t.String({ maxLength: 100 })),
  addressType: t.Optional(t.Union([t.Literal('shipping'), t.Literal('billing'), t.Literal('both')])),
  name: t.Optional(t.String({ maxLength: 255 })),
  company: t.Optional(t.String({ maxLength: 255 })),
  line1: t.String({ maxLength: 255 }),
  line2: t.Optional(t.String({ maxLength: 255 })),
  city: t.Optional(t.String({ maxLength: 100 })),
  state: t.Optional(t.String({ maxLength: 100 })),
  postalCode: t.Optional(t.String({ maxLength: 20 })),
  country: t.String({ minLength: 2, maxLength: 3 }),
  phone: t.Optional(t.String({ maxLength: 50 }))
})

export const addressParams = t.Object({
  slug: t.String(),
  id: t.String()
})

export const setDefaultAddressParams = t.Object({
  slug: t.String(),
  id: t.String()
})
