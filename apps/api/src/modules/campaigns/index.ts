import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { CampaignsService } from './service'

const campaignBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  type: t.Optional(t.String()),
  audience: t.Optional(t.Record(t.String(), t.Any())),
  subject: t.Optional(t.String()),
  content: t.Optional(t.String()),
  triggerType: t.Optional(t.String()),
  triggerDelayHours: t.Optional(t.Integer({ minimum: 0 })),
  scheduledAt: t.Optional(t.String())
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

export const campaignsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/campaigns', async ({ auth }) => CampaignsService.list(auth.merchant.id))
  .get('/campaigns/:id', async ({ auth, params }) => CampaignsService.get(auth.merchant.id, params.id))

  .use(requirePermission('settings:write'))
  .post('/campaigns', async ({ auth, body }) => CampaignsService.create(auth.merchant.id, body), { body: createBody })
  .put('/campaigns/:id', async ({ auth, params, body }) => CampaignsService.update(auth.merchant.id, params.id, body), { body: campaignBody })
  .post('/campaigns/:id/send', async ({ auth, params }) => CampaignsService.send(auth.merchant.id, params.id))
  .delete('/campaigns/:id', async ({ auth, params }) => CampaignsService.delete(auth.merchant.id, params.id))
