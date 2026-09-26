import { t } from 'elysia'

export const reviewStatusSchema = t.Enum({ pending: 'pending', approved: 'approved', rejected: 'rejected' })

export const reviewQuery = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  status: t.Optional(reviewStatusSchema),
  productId: t.Optional(t.String()),
  rating: t.Optional(t.String())
})

export const reviewParams = t.Object({ id: t.String() })

export const reviewUpdateBody = t.Object({
  status: reviewStatusSchema
})

export const reviewBulkBody = t.Object({
  ids: t.Array(t.String(), { minItems: 1, maxItems: 200 }),
  status: reviewStatusSchema
})

export const reviewReplyBody = t.Object({
  body: t.String({ minLength: 1, maxLength: 5000 })
})

export const reviewHelpfulBody = t.Object({
  customerId: t.Optional(t.String())
})
