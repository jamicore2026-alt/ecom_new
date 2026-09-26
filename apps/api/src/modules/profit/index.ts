import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { branchScopeOf } from '../../shared/outlet-scope'
import { ProfitService } from './service'

const rangeQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String())
})

export const profitModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  // Module gate: the profit report is analytics-module surface.
  .use(outletGuard({ module: 'analytics' }))
  .use(requirePermission('reports.read'))
  .get('/profit', async ({ auth, query }) =>
    ProfitService.report(auth.db, auth.merchant.id, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined
    }, await branchScopeOf(auth.db, auth)), { query: rangeQuery })
