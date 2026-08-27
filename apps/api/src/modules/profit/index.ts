import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { ProfitService } from './service'

const rangeQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String())
})

export const profitModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/profit', async ({ auth, query }) =>
    ProfitService.report(auth.merchant.id, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined
    }), { query: rangeQuery })
