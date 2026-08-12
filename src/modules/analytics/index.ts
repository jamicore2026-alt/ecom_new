import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { AnalyticsService } from './service'

export const analyticsQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  interval: t.Optional(t.Enum({ day: 'day', week: 'week', month: 'month' }))
})

export const analyticsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('analytics:read'))
  .get('/analytics/sales', async ({ query, auth }) =>
    AnalyticsService.sales(auth.merchant.id, query), { query: analyticsQuery }
  )
  .get('/analytics/products', async ({ query, auth }) =>
    AnalyticsService.products(auth.merchant.id, query), { query: analyticsQuery }
  )
  .get('/analytics/customers', async ({ query, auth }) =>
    AnalyticsService.customers(auth.merchant.id, query), { query: analyticsQuery }
  )
  .get('/analytics/conversion', async ({ query, auth }) =>
    AnalyticsService.conversion(auth.merchant.id, query), { query: analyticsQuery }
  )