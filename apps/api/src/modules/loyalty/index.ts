import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { LoyaltyService } from './service'

const adjustBody = t.Object({
  customerId: t.String(),
  points: t.Integer(),
  type: t.String({ minLength: 1 }),
  reference: t.Optional(t.String()),
  meta: t.Optional(t.Record(t.String(), t.Any()))
})

export const loyaltyModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('customers.read'))

  .get('/loyalty/overview', async ({ auth }) => LoyaltyService.overview(auth.merchant.id))
  .get('/loyalty/:customerId', async ({ auth, params }) => LoyaltyService.getByCustomer(auth.merchant.id, params.customerId))
  .get('/loyalty/:customerId/ledger', async ({ auth, params }) => LoyaltyService.ledger(auth.merchant.id, params.customerId))

  .use(requirePermission('settings:write'))
  .post('/loyalty/adjust', async ({ auth, body }) => LoyaltyService.adjust(auth.merchant.id, body.customerId, body), { body: adjustBody })
