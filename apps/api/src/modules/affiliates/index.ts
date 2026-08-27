import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { AffiliatesService } from './service'

const affiliateBody = t.Object({
  name: t.String({ minLength: 1 }),
  email: t.String({ format: 'email' }),
  referralCode: t.String({ minLength: 1 }),
  commissionRate: t.Number({ minimum: 0, maximum: 100 })
})

export const affiliatesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/affiliates', async ({ auth }) => AffiliatesService.list(auth.merchant.id))
  .get('/affiliates/:id/referrals', async ({ auth, params }) => AffiliatesService.referrals(auth.merchant.id, params.id))

  .use(requirePermission('settings:write'))
  .post('/affiliates', async ({ auth, body }) => AffiliatesService.create(auth.merchant.id, body), { body: affiliateBody })
