import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { branchScopeOf } from '../../shared/outlet-scope'
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
    return FulfillmentsService.list(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), query)
  }, { query: fulfillmentQuery })

  .get('/fulfillments/:id', async ({ auth, params }) => {
    return FulfillmentsService.get(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: fulfillmentParams })

  .use(requirePermission('orders.create', 'orders.update', 'orders.cancel'))
  .post('/fulfillments', async ({ auth, body }) => {
    return FulfillmentsService.create(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), body)
  }, { body: createFulfillmentBody })

  .put('/fulfillments/:id', async ({ auth, params, body }) => {
    return FulfillmentsService.update(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id, body)
  }, { params: fulfillmentParams, body: updateFulfillmentBody })

  .post('/fulfillments/:id/ship', async ({ auth, params, body }) => {
    return FulfillmentsService.markShipped(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id, body)
  }, { params: fulfillmentParams, body: markShippedBody })

  .post('/fulfillments/:id/cancel', async ({ auth, params }) => {
    return FulfillmentsService.cancel(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth), params.id)
  }, { params: fulfillmentParams })
