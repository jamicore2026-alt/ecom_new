import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { OverviewService } from './service'

export const overviewModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('analytics:read'))
  .get('/overview', async ({ auth }) => OverviewService.dashboard(auth.merchant.id))
