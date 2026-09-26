import { Elysia } from 'elysia'
import { t } from 'elysia'
import { eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { merchants } from '../../database/schema'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { badRequest } from '../../shared/errors'
import { CampaignsService } from './service'
import { CustomersService } from '../customers/service'

const campaignBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  type: t.Optional(t.String()),
  audience: t.Optional(t.Record(t.String(), t.Any())),
  subject: t.Optional(t.String()),
  content: t.Optional(t.String()),
  triggerType: t.Optional(t.String()),
  triggerDelayHours: t.Optional(t.Integer({ minimum: 0 })),
  scheduledAt: t.Optional(t.Union([t.String(), t.Null()])),
  status: t.Optional(t.Enum({ draft: 'draft', scheduled: 'scheduled', template: 'template' }))
})

const createBody = t.Object({
  name: t.String({ minLength: 1 }),
  type: t.Optional(t.String()),
  audience: t.Optional(t.Record(t.String(), t.Any())),
  subject: t.Optional(t.String()),
  content: t.Optional(t.String()),
  triggerType: t.Optional(t.String()),
  triggerDelayHours: t.Optional(t.Integer({ minimum: 0 })),
  scheduledAt: t.Optional(t.String())
})

const templateBody = t.Object({
  name: t.String({ minLength: 1 }),
  subject: t.Optional(t.String()),
  content: t.Optional(t.String())
})

const fromTemplateBody = t.Object({
  templateId: t.String({ minLength: 1 }),
  name: t.String({ minLength: 1 })
})

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
  'base64'
)

export const campaignsModule = new Elysia({ prefix: '/api' })
  // Public open-pixel (1x1 transparent gif) — keyed by per-campaign trackToken.
  .get('/campaigns/track/:token/open', async ({ params, query }) => {
    await CampaignsService.trackOpen(db, params.token, (query as Record<string, string>).cid)
    return new Response(PIXEL, { headers: { 'content-type': 'image/gif', 'cache-control': 'no-store' } })
  })
  // Public click redirect — increments clicks, then 302s to `to` (validated http(s)).
  .get('/campaigns/track/:token/click', async ({ params, query, set }) => {
    await CampaignsService.trackClick(db, params.token, (query as Record<string, string>).cid)
    const to = (query as Record<string, string>).to ?? process.env.PUBLIC_STOREFRONT_URL ?? 'http://localhost:5479'
    set.status = 302
    set.headers['location'] = /^https?:\/\//.test(to) ? to : 'http://localhost:5479'
    return 'redirecting'
  })
  // Public unsubscribe — flips customers.marketing_opt_out by email+merchant.
  .get('/campaigns/unsubscribe', async ({ query }) => {
    const q = query as Record<string, string>
    if (!q.email || !q.mid) throw badRequest('BAD_REQUEST', 'email and mid are required')
    const [merchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.id, q.mid))
    if (!merchant) throw badRequest('BAD_REQUEST', 'Unknown merchant')
    return CustomersService.unsubscribeByEmail(db, merchant.id, q.email)
  })
  .post('/campaigns/unsubscribe', async ({ body }) => {
    const { email, merchantId } = body as { email: string; merchantId: string }
    if (!email || !merchantId) throw badRequest('BAD_REQUEST', 'email and merchantId are required')
    return CustomersService.unsubscribeByEmail(db, merchantId, email)
  }, {
    body: t.Object({ email: t.String(), merchantId: t.String() })
  })

  .use(authPlugin)
  .use(requirePermission('settings.manage'))

  .get('/campaigns', async ({ auth }) => CampaignsService.list(auth.db, auth.merchant.id))
  .get('/campaigns/templates', async ({ auth }) => CampaignsService.listTemplates(auth.db, auth.merchant.id))
  .get('/campaigns/:id', async ({ auth, params }) => CampaignsService.get(auth.db, auth.merchant.id, params.id))
  .get('/campaigns/:id/stats', async ({ auth, params }) => CampaignsService.stats(auth.db, auth.merchant.id, params.id))

  .use(requirePermission('settings.manage'))
  .post('/campaigns', async ({ auth, body }) => CampaignsService.create(auth.db, auth.merchant.id, body), { body: createBody })
  .post('/campaigns/templates', async ({ auth, body }) => CampaignsService.saveTemplate(auth.db, auth.merchant.id, body), { body: templateBody })
  .post('/campaigns/from-template', async ({ auth, body }) => CampaignsService.createFromTemplate(auth.db, auth.merchant.id, body.templateId, body.name), { body: fromTemplateBody })
  .put('/campaigns/:id', async ({ auth, params, body }) => CampaignsService.update(auth.db, auth.merchant.id, params.id, body), { body: campaignBody })
  .post('/campaigns/:id/send', async ({ auth, params }) => CampaignsService.send(auth.db, auth.merchant.id, params.id))
  .delete('/campaigns/:id', async ({ auth, params }) => CampaignsService.delete(auth.db, auth.merchant.id, params.id))
