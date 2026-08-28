import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { FoodOrdersService } from './service'
import {
  foodOrderCreateBody,
  foodOrderUpdateBody,
  foodOrderStatusBody,
  foodOrderParams,
  foodOrderQuery
} from './model'

export const foodOrdersModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'restaurant', permissions: ['orders.read'] }))
  .get('/food-orders', async ({ query, auth }) => FoodOrdersService.list(auth.merchant.id, query), {
    query: foodOrderQuery,
    detail: { summary: 'List food orders with filters' }
  })
  .get('/food-orders/:id', async ({ params, auth }) => FoodOrdersService.get(auth.merchant.id, params.id), {
    params: foodOrderParams,
    detail: { summary: 'Get a food order with its items' }
  })

  .use(outletGuard({ module: 'restaurant', permissions: ['orders.create'] }))
  .post('/food-orders', async ({ body, auth, request }) => {
    const result = await FoodOrdersService.create(auth.merchant.id, body)
    auditFromRequest(auth, request, {
      action: 'food_order.create',
      entityType: 'order',
      entityId: (result.data as { id: string }).id
    })
    return result
  }, { body: foodOrderCreateBody })

  .use(outletGuard({ module: 'restaurant', permissions: ['orders.update'] }))
  .put('/food-orders/:id', async ({ params, body, auth, request }) => {
    const result = await FoodOrdersService.update(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'food_order.update', entityType: 'order', entityId: params.id })
    return result
  }, { params: foodOrderParams, body: foodOrderUpdateBody })
  .post('/food-orders/:id/status', async ({ params, body, auth, request }) => {
    const result = await FoodOrdersService.transition(auth.merchant.id, params.id, body.status)
    auditFromRequest(auth, request, { action: 'food_order.status', entityType: 'order', entityId: params.id, metadata: { status: body.status } })
    return result
  }, { params: foodOrderParams, body: foodOrderStatusBody })
  .post('/food-orders/:id/cancel', async ({ params, auth, request }) => {
    const result = await FoodOrdersService.cancel(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'food_order.cancel', entityType: 'order', entityId: params.id })
    return result
  }, { params: foodOrderParams })
