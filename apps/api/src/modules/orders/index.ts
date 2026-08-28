import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { OrdersService } from './service'
import {
  createRefundBody,
  createReturnBody,
  orderQuery,
  updateReturnBody,
  updateStatusBody
} from './model'

export const ordersModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/orders', async ({ query, auth }) => OrdersService.list(auth.merchant.id, query), {
    query: orderQuery
  })
  .get('/orders/:id', async ({ params, auth }) => OrdersService.get(auth.merchant.id, params.id))
  .get('/returns', async ({ query, auth }) =>
    OrdersService.listReturns(auth.merchant.id, query.orderId)
  )
  .get('/refunds', async ({ query, auth }) =>
    OrdersService.listRefunds(auth.merchant.id, query.orderId)
  )
  .use(requirePermission('orders:write'))
  .patch(
    '/orders/:id/status',
    async ({ params, body, auth, request }) => {
      const result = await OrdersService.updateStatus(auth.merchant.id, params.id, body)
      auditFromRequest(auth, request, {
        action: 'order.status_change',
        entityType: 'order',
        entityId: params.id,
        metadata: { status: body.status }
      })
      return result
    },
    { body: updateStatusBody }
  )
  .post('/orders/:id/cancel', async ({ params, auth }) => OrdersService.cancel(auth.merchant.id, params.id))
  .post('/returns', async ({ body, auth }) => OrdersService.createReturn(auth.merchant.id, body), {
    body: createReturnBody
  })
  .patch('/returns/:id', async ({ params, body, auth }) =>
    OrdersService.updateReturn(auth.merchant.id, params.id, body), { body: updateReturnBody }
  )
  .post('/refunds', async ({ body, auth }) => OrdersService.createRefund(auth.merchant.id, body), {
    body: createRefundBody
  })
  .post('/refunds/:id/retry', async ({ params, auth }) =>
    OrdersService.retryRefund(auth.merchant.id, params.id)
  )