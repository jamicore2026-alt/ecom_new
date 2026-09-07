import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { branchScopeOf } from '../../shared/outlet-scope'
import { OverviewService } from './service'

export const overviewModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('reports.read'))
  .get('/overview', async ({ auth }) => OverviewService.dashboard(auth.merchant.id, await branchScopeOf(auth)))
