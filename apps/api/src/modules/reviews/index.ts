import { Elysia, t } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { merchants } from '../../database/schema'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { notFound } from '../../shared/errors'
import { auditFromRequest } from '../audit-logs'
import { ReviewsService } from './service'
import { reviewBulkBody, reviewHelpfulBody, reviewParams, reviewQuery, reviewReplyBody, reviewUpdateBody } from './model'

export const reviewsModule = new Elysia({ prefix: '/api' })
  // Public helpful vote (storefront PDP, merchant-scoped by store slug).
  // Best-effort uniqueness — see service note.
  .post(
    '/store/:slug/reviews/:id/helpful',
    async ({ params, body }) => {
      const [merchant] = await db
        .select({ id: merchants.id })
        .from(merchants)
        .where(and(eq(merchants.slug, params.slug), eq(merchants.status, 'active')))
      if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')
      return ReviewsService.markHelpful(db, merchant.id, params.id, body?.customerId)
    },
    {
      params: t.Object({ slug: t.String(), id: t.String() }),
      body: reviewHelpfulBody,
      detail: { tags: ['Reviews'], summary: 'Mark a review helpful (storefront)' }
    }
  )
  .use(authPlugin)
  .get(
    '/reviews',
    ({ query, auth }) => ReviewsService.list(auth.db, auth.merchant.id, query),
    { query: reviewQuery, detail: { tags: ['Reviews'], summary: 'List product reviews' } }
  )
  .get(
    '/reviews/:id/replies',
    ({ params, auth }) => ReviewsService.listReplies(auth.db, auth.merchant.id, params.id),
    { params: reviewParams, detail: { tags: ['Reviews'], summary: 'List merchant replies (Q&A thread)' } }
  )
  .use(requirePermission('products.create', 'products.update', 'products.delete'))
  .post(
    '/reviews/bulk-moderate',
    async ({ body, auth, request }) => {
      const result = await ReviewsService.bulkModerate(auth.db, auth.merchant.id, body.ids, body.status)
      await auditFromRequest(auth, request, {
        action: 'review.bulk_moderate',
        entityType: 'review',
        metadata: { status: body.status, count: result.data.updated }
      })
      return result
    },
    {
      body: reviewBulkBody,
      detail: { tags: ['Reviews'], summary: 'Bulk moderate reviews (approve / reject / reset)' }
    }
  )
  .post(
    '/reviews/:id/replies',
    async ({ params, body, auth, request }) => {
      const result = await ReviewsService.addReply(auth.db, auth.merchant.id, params.id, body.body, auth.user?.id)
      await auditFromRequest(auth, request, {
        action: 'review.reply',
        entityType: 'review',
        entityId: params.id
      })
      return result
    },
    {
      params: reviewParams,
      body: reviewReplyBody,
      detail: { tags: ['Reviews'], summary: 'Post a merchant reply (doubles as Q&A answer)' }
    }
  )
  .post(
    '/reviews/:id/helpful',
    ({ params, body, auth }) => ReviewsService.markHelpful(auth.db, auth.merchant.id, params.id, body?.customerId),
    {
      params: reviewParams,
      body: reviewHelpfulBody,
      detail: { tags: ['Reviews'], summary: 'Mark a review helpful' }
    }
  )
  .patch(
    '/reviews/:id',
    async ({ params, body, auth, request }) => {
      const result = await ReviewsService.update(auth.db, auth.merchant.id, params.id, body)
      await auditFromRequest(auth, request, {
        action: 'review.moderate',
        entityType: 'review',
        entityId: params.id,
        metadata: { status: body.status }
      })
      return result
    },
    {
      params: reviewParams,
      body: reviewUpdateBody,
      detail: { tags: ['Reviews'], summary: 'Moderate a review (approve / reject / reset)' }
    }
  )
  .delete(
    '/reviews/:id',
    ({ params, auth }) => ReviewsService.remove(auth.db, auth.merchant.id, params.id),
    { params: reviewParams, detail: { tags: ['Reviews'], summary: 'Delete a review' } }
  )
