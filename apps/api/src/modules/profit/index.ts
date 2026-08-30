import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { ProfitService } from './service'

const rangeQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String())
})

export const profitModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('reports.read'))
  .get('/profit', async ({ auth, query }) =>
    ProfitService.report(auth.merchant.id, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined
    }), { query: rangeQuery })
