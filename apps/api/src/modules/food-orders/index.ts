import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { FoodOrdersService } from './service'
import {
  foodOrderCreateBody,
  foodOrderUpdateBody,
  foodOrderStatusBody,
  foodOrderPayBody,
  foodOrderParams,
  foodOrderQuery
} from './model'

export const foodOrdersModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'restaurant', permissions: ['orders.read'] }))
  .get('/food-orders', async ({ query, auth, merchantContext }) =>
    FoodOrdersService.list(auth.merchant.id, query, merchantContext), {
    query: foodOrderQuery,
    detail: { summary: 'List food orders with filters' }
  })
  .get('/food-orders/:id', async ({ params, auth, merchantContext }) =>
    FoodOrdersService.get(auth.merchant.id, params.id, merchantContext), {
    params: foodOrderParams,
    detail: { summary: 'Get a food order with its items' }
  })

  .use(outletGuard({ module: 'restaurant', permissions: ['orders.create'] }))
  .post('/food-orders', async ({ body, auth, request, merchantContext }) => {
    const result = await FoodOrdersService.create(auth.merchant.id, body, merchantContext)
    auditFromRequest(auth, request, {
      action: 'food_order.create',
      entityType: 'order',
      entityId: (result.data as { id: string }).id
    })
    return result
  }, { body: foodOrderCreateBody })

  .use(outletGuard({ module: 'restaurant', permissions: ['orders.update'] }))
  .put('/food-orders/:id', async ({ params, body, auth, request, merchantContext }) => {
    const result = await FoodOrdersService.update(auth.merchant.id, params.id, body, merchantContext)
    auditFromRequest(auth, request, { action: 'food_order.update', entityType: 'order', entityId: params.id })
    return result
  }, { params: foodOrderParams, body: foodOrderUpdateBody })

  .use(outletGuard({ module: 'restaurant', permissions: ['payments.create'] }))
  .post('/food-orders/:id/pay', async ({ params, body, auth, request, merchantContext }) => {
    const result = await FoodOrdersService.pay(auth.merchant.id, params.id, body.paymentMethod, body.cashReceived, merchantContext)
    auditFromRequest(auth, request, { action: 'food_order.payment', entityType: 'order', entityId: params.id, metadata: { paymentMethod: body.paymentMethod ?? 'cash', cashReceived: body.cashReceived ?? null } })
    return result
  }, { params: foodOrderParams, body: foodOrderPayBody })

  .post('/food-orders/:id/status', async ({ params, body, auth, request, merchantContext }) => {
    const result = await FoodOrdersService.transition(auth.merchant.id, params.id, body.status, merchantContext)
    auditFromRequest(auth, request, { action: 'food_order.status', entityType: 'order', entityId: params.id, metadata: { status: body.status } })
    return result
  }, { params: foodOrderParams, body: foodOrderStatusBody })
  .post('/food-orders/:id/cancel', async ({ params, auth, request, merchantContext }) => {
    const result = await FoodOrdersService.cancel(auth.merchant.id, params.id, merchantContext)
    auditFromRequest(auth, request, { action: 'food_order.cancel', entityType: 'order', entityId: params.id })
    return result
  }, { params: foodOrderParams })
