import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { FulfillmentsService } from './service'
import {
  createFulfillmentBody,
  fulfillmentParams,
  fulfillmentQuery,
  markShippedBody,
  updateFulfillmentBody
} from './model'

export const fulfillmentsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('orders.read'))

  .get('/fulfillments', async ({ auth, query }) => {
    return FulfillmentsService.list(auth.merchant.id, query)
  }, { query: fulfillmentQuery })

  .get('/fulfillments/:id', async ({ auth, params }) => {
    return FulfillmentsService.get(auth.merchant.id, params.id)
  }, { params: fulfillmentParams })

  .use(requirePermission('orders:write'))
  .post('/fulfillments', async ({ auth, body }) => {
    return FulfillmentsService.create(auth.merchant.id, body)
  }, { body: createFulfillmentBody })

  .put('/fulfillments/:id', async ({ auth, params, body }) => {
    return FulfillmentsService.update(auth.merchant.id, params.id, body)
  }, { params: fulfillmentParams, body: updateFulfillmentBody })

  .post('/fulfillments/:id/ship', async ({ auth, params, body }) => {
    return FulfillmentsService.markShipped(auth.merchant.id, params.id, body)
  }, { params: fulfillmentParams, body: markShippedBody })

  .post('/fulfillments/:id/cancel', async ({ auth, params }) => {
    return FulfillmentsService.cancel(auth.merchant.id, params.id)
  }, { params: fulfillmentParams })
