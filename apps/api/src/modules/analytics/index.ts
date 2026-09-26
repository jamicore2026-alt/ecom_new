import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { branchScopeOf } from '../../shared/outlet-scope'
import { AnalyticsService } from './service'

export const analyticsQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  interval: t.Optional(t.Enum({ day: 'day', week: 'week', month: 'month' }))
})

export const analyticsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  // Module gate: the analytics module must be enabled for the merchant.
  .use(outletGuard({ module: 'analytics' }))
  .use(requirePermission('reports.read'))
  .get('/analytics/sales', async ({ query, auth }) =>
    AnalyticsService.sales(auth.db, auth.merchant.id, query, await branchScopeOf(auth.db, auth)), { query: analyticsQuery }
  )
  .get('/analytics/products', async ({ query, auth }) =>
    AnalyticsService.products(auth.db, auth.merchant.id, query, await branchScopeOf(auth.db, auth)), { query: analyticsQuery }
  )
  .get('/analytics/customers', async ({ query, auth }) =>
    AnalyticsService.customers(auth.db, auth.merchant.id, query, await branchScopeOf(auth.db, auth)), { query: analyticsQuery }
  )
  .get('/analytics/conversion', async ({ query, auth }) =>
    AnalyticsService.conversion(auth.db, auth.merchant.id, query, await branchScopeOf(auth.db, auth)), { query: analyticsQuery }
  )
  .get('/analytics/channels', async ({ query, auth }) =>
    AnalyticsService.channels(auth.db, auth.merchant.id, query, await branchScopeOf(auth.db, auth)), { query: analyticsQuery }
  )
  .get('/analytics/clv', async ({ query, auth }) =>
    AnalyticsService.clv(auth.db, auth.merchant.id, query, await branchScopeOf(auth.db, auth)), { query: analyticsQuery }
  )
  .get('/analytics/refunds', async ({ query, auth }) =>
    AnalyticsService.refundRates(auth.db, auth.merchant.id, query, await branchScopeOf(auth.db, auth)), { query: analyticsQuery }
  )
  .get('/analytics/cohorts', async ({ query, auth }) =>
    AnalyticsService.cohorts(auth.db, auth.merchant.id, query), { query: analyticsQuery }
  )
  // registered last so "export" siblings above are unaffected; ?type= selects
  // the dataset. CSV mirrors the JSON endpoints for offline analysis.
  .get('/analytics/export', async ({ query, auth }) => {
    const type = (query as Record<string, string | undefined>).type ?? 'sales'
    const csv = await AnalyticsService.exportCsv(auth.db, auth.merchant.id, type, query, await branchScopeOf(auth.db, auth))
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="analytics-${type}-${new Date().toISOString().slice(0, 10)}.csv"`
      }
    })
  }, { query: t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()), interval: t.Optional(t.Enum({ day: 'day', week: 'week', month: 'month' })), type: t.Optional(t.String()) }) })