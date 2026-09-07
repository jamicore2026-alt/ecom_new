import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import type { AuthContext } from '../../plugins/auth'
import { branchScopeOf } from '../../shared/outlet-scope'
import { auditFromRequest } from '../audit-logs'
import { OrdersService } from './service'
import {
  createRefundBody,
  createReturnBody,
  orderQuery,
  updateReturnBody,
  updateStatusBody
} from './model'

const scopeOf = async (auth: AuthContext) => branchScopeOf(auth)

export const ordersModule = new Elysia({ prefix: '/api' })
  // Outlet scope: reads are filtered by the caller's branch scope
  // (branchOrderCondition in service.list/export) and row-level reads/writes
  // are asserted per order (assertOrderInBranchScope). Owners/admins are
  // merchant-wide. docs/outlet-isolation.md
  .use(authPlugin)
  .get('/orders', async ({ query, auth }) =>
    OrdersService.list(auth.merchant.id, query, await scopeOf(auth)),
    {
      query: orderQuery
    }
  )
  // registered before '/orders/:id' so "export" is not captured as an id
  .get(
    '/orders/export',
    async ({ auth, set }) => {
      const csv = await OrdersService.exportCsv(auth.merchant.id, await scopeOf(auth))
      set.headers['content-type'] = 'text/csv; charset=utf-8'
      set.headers['content-disposition'] = `attachment; filename="orders-${auth.merchant.slug}-${new Date().toISOString().slice(0, 10)}.csv"`
      return csv
    },
    { detail: { summary: 'Export orders as CSV' } }
  )
  .get('/orders/:id', async ({ params, auth }) =>
    OrdersService.get(auth.merchant.id, params.id, await scopeOf(auth))
  )
  .get('/returns', async ({ query, auth }) =>
    OrdersService.listReturns(auth.merchant.id, query.orderId, await scopeOf(auth))
  )
  .get('/refunds', async ({ query, auth }) =>
    OrdersService.listRefunds(auth.merchant.id, query.orderId, await scopeOf(auth))
  )
  .use(requirePermission('orders.create', 'orders.update', 'orders.cancel'))
  .patch(
    '/orders/:id/status',
    async ({ params, body, auth, request }) => {
      const result = await OrdersService.updateStatus(
        auth.merchant.id,
        params.id,
        body,
        await scopeOf(auth)
      )
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
  .post('/orders/:id/cancel', async ({ params, auth }) =>
    OrdersService.cancel(auth.merchant.id, params.id, await scopeOf(auth))
  )
  .post('/returns', async ({ body, auth }) =>
    OrdersService.createReturn(auth.merchant.id, body, await scopeOf(auth)),
    {
      body: createReturnBody
    }
  )
  .patch('/returns/:id', async ({ params, body, auth }) =>
    OrdersService.updateReturn(auth.merchant.id, params.id, body, await scopeOf(auth)), { body: updateReturnBody }
  )
  .post('/refunds', async ({ body, auth }) =>
    OrdersService.createRefund(auth.merchant.id, body, await scopeOf(auth)),
    {
      body: createRefundBody
    }
  )
  .post('/refunds/:id/retry', async ({ params, auth }) =>
    OrdersService.retryRefund(auth.merchant.id, params.id, await scopeOf(auth))
  )