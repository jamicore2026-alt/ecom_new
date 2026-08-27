import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { SegmentsService } from './service'
import type { SegmentDefinition } from './service'

const segmentBody = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  definition: t.Optional(
    t.Object({
      minSpent: t.Optional(t.Number({ minimum: 0 })),
      minOrders: t.Optional(t.Integer({ minimum: 0 }))
    })
  )
})

const requiredBody = t.Object({
  name: t.String({ minLength: 1 }),
  definition: t.Object({
    minSpent: t.Optional(t.Number({ minimum: 0 })),
    minOrders: t.Optional(t.Integer({ minimum: 0 }))
  })
})

const previewBody = t.Object({
  definition: t.Object({
    minSpent: t.Optional(t.Number({ minimum: 0 })),
    minOrders: t.Optional(t.Integer({ minimum: 0 }))
  })
})

export const segmentsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/segments', async ({ auth }) => SegmentsService.list(auth.merchant.id))
  .get('/segments/:id', async ({ auth, params }) => SegmentsService.get(auth.merchant.id, params.id))
  .post('/segments/preview', async ({ auth, body }) => SegmentsService.preview(auth.merchant.id, body.definition), { body: previewBody })

  .use(requirePermission('settings:write'))
  .post('/segments', async ({ auth, body }) => SegmentsService.create(auth.merchant.id, body), { body: requiredBody })
  .put('/segments/:id', async ({ auth, params, body }) => SegmentsService.update(auth.merchant.id, params.id, body as { name?: string; definition?: SegmentDefinition }), { body: segmentBody })
  .delete('/segments/:id', async ({ auth, params }) => SegmentsService.delete(auth.merchant.id, params.id))
