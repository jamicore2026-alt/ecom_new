import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { SegmentsService } from './service'
import type { SegmentDefinition } from './service'

const definitionSchema = t.Object({
  minSpent: t.Optional(t.Number({ minimum: 0 })),
  minOrders: t.Optional(t.Integer({ minimum: 0 })),
  recencyDays: t.Optional(t.Integer({ minimum: 1, maximum: 3650 })),
  tags: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 100 })))
})

const segmentBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  definition: t.Optional(definitionSchema)
})

const requiredBody = t.Object({
  name: t.String({ minLength: 1 }),
  definition: definitionSchema
})

const previewBody = t.Object({
  definition: definitionSchema
})

export const segmentsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/segments', async ({ auth }) => SegmentsService.list(auth.db, auth.merchant.id))
  .get('/segments/:id', async ({ auth, params }) => SegmentsService.get(auth.db, auth.merchant.id, params.id))
  .get('/segments/:id/members', async ({ auth, params }) => SegmentsService.members(auth.db, auth.merchant.id, params.id))
  .post('/segments/preview', async ({ auth, body }) => SegmentsService.preview(auth.db, auth.merchant.id, body.definition), { body: previewBody })

  .use(requirePermission('settings.manage'))
  .post('/segments', async ({ auth, body }) => SegmentsService.create(auth.db, auth.merchant.id, body), { body: requiredBody })
  .put('/segments/:id', async ({ auth, params, body }) => SegmentsService.update(auth.db, auth.merchant.id, params.id, body as { name?: string; definition?: SegmentDefinition }), { body: segmentBody })
  .post('/segments/:id/refresh', async ({ auth, params }) => SegmentsService.refresh(auth.db, auth.merchant.id, params.id))
  .post('/segments/refresh', async ({ auth }) => SegmentsService.refresh(auth.db, auth.merchant.id))
  .delete('/segments/:id', async ({ auth, params }) => SegmentsService.delete(auth.db, auth.merchant.id, params.id))
