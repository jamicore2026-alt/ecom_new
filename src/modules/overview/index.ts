import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { OverviewService } from './service'

export const overviewModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/overview', async ({ auth }) => OverviewService.dashboard(auth.merchant.id))
