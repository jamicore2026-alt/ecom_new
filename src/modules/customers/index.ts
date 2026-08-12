import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { CustomersService } from './service'
import { customerQuery } from './model'

export const customersModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/customers', async ({ query, auth }) => CustomersService.list(auth.merchant.id, query), {
    query: customerQuery
  })
  .get('/customers/:id', async ({ params, auth }) => CustomersService.get(auth.merchant.id, params.id))
  .get('/customers/:id/orders', async ({ params, query, auth }) =>
    CustomersService.orders(auth.merchant.id, params.id, query), { query: customerQuery }
  )
