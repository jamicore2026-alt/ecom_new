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
