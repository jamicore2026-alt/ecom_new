import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { ReviewsService } from './service'
import { reviewParams, reviewQuery, reviewUpdateBody } from './model'

export const reviewsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get(
    '/reviews',
    ({ query, auth }) => ReviewsService.list(auth.merchant.id, query),
    { query: reviewQuery, detail: { tags: ['Reviews'], summary: 'List product reviews' } }
  )
  .use(requirePermission('products:write'))
  .patch(
    '/reviews/:id',
    ({ params, body, auth }) => ReviewsService.update(auth.merchant.id, params.id, body),
    {
      params: reviewParams,
      body: reviewUpdateBody,
      detail: { tags: ['Reviews'], summary: 'Moderate a review (approve / reject / reset)' }
    }
  )
  .delete(
    '/reviews/:id',
    ({ params, auth }) => ReviewsService.remove(auth.merchant.id, params.id),
    { params: reviewParams, detail: { tags: ['Reviews'], summary: 'Delete a review' } }
  )
