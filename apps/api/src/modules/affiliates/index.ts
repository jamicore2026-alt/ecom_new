import { Elysia } from 'elysia'
import { t } from 'elysia'
import { db } from '../../database/client'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { AffiliatesService } from './service'

const affiliateBody = t.Object({
  name: t.String({ minLength: 1 }),
  email: t.String({ format: 'email' }),
  referralCode: t.String({ minLength: 1 }),
  commissionRate: t.Number({ minimum: 0, maximum: 100 })
})

const trackBody = t.Object({
  code: t.String({ minLength: 1 }),
  customerId: t.Optional(t.String()),
  merchantId: t.Optional(t.String())
})

const cancelBody = t.Object({
  reason: t.Optional(t.String())
})

const payoutBody = t.Object({
  affiliateIds: t.Optional(t.Array(t.String())),
  minPayout: t.Optional(t.Number({ minimum: 0 }))
})

export const affiliatesModule = new Elysia({ prefix: '/api' })
  // Public click tracking (storefront, anonymous ok) — registered before the
  // auth plugin so no credentials are required. Uses the platform connection
  // directly; the affiliate row itself scopes the merchant.
  .post('/affiliates/track', async ({ body }) => AffiliatesService.trackClick(db, body), {
    body: trackBody
  })

  .use(authPlugin)
  .use(requirePermission('settings.manage'))

  .get('/affiliates', async ({ auth }) => AffiliatesService.list(auth.db, auth.merchant.id))
  .get('/affiliates/:id/referrals', async ({ auth, params }) => AffiliatesService.referrals(auth.db, auth.merchant.id, params.id))

  .use(requirePermission('settings.manage'))
  .post('/affiliates', async ({ auth, body }) => AffiliatesService.create(auth.db, auth.merchant.id, body), { body: affiliateBody })
  .post('/affiliates/referrals/:id/approve', async ({ auth, params }) =>
    AffiliatesService.approveReferral(auth.db, auth.merchant.id, params.id)
  )
  .post('/affiliates/referrals/:id/cancel', async ({ auth, params, body }) =>
    AffiliatesService.cancelReferral(auth.db, auth.merchant.id, params.id, body?.reason), { body: t.Optional(cancelBody) }
  )
  .post('/affiliates/payouts', async ({ auth, body }) =>
    AffiliatesService.runPayout(auth.db, auth.merchant.id, body ?? {}), { body: t.Optional(payoutBody) }
  )
