import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { branchScopeOf } from '../../shared/outlet-scope'
import { OverviewService } from './service'

export const overviewModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  // Module gate: the dashboard is analytics-module surface.
  .use(outletGuard({ module: 'analytics' }))
  .use(requirePermission('reports.read'))
  .get('/overview', async ({ auth }) => OverviewService.dashboard(auth.db, auth.merchant.id, await branchScopeOf(auth.db, auth)))
