import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { tenantRateLimiter } from '../../shared/rate-limit'
import { ContentService } from './service'

const pageBody = t.Object({
  title: t.Optional(t.String({ minLength: 1 })),
  slug: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  content: t.Optional(t.String()),
  status: t.Optional(t.Union([t.Literal('draft'), t.Literal('scheduled'), t.Literal('published'), t.Literal('archived')])),
  publishedAt: t.Optional(t.Union([t.String(), t.Null()])),
  metaTitle: t.Optional(t.String()),
  metaDescription: t.Optional(t.String())
})

const createBody = t.Object({
  title: t.String({ minLength: 1 }),
  slug: t.String({ minLength: 1, maxLength: 255 }),
  content: t.Optional(t.String()),
  status: t.Optional(t.Union([t.Literal('draft'), t.Literal('scheduled'), t.Literal('published'), t.Literal('archived')])),
  publishedAt: t.Optional(t.String())
})

export const contentModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/content', async ({ auth }) => ContentService.list(auth.db, auth.merchant.id))
  .get('/content/:id', async ({ auth, params }) => ContentService.get(auth.db, auth.merchant.id, params.id))

  .use(requirePermission('products.create', 'products.update', 'products.delete'))
  // Exact per-tenant write budget (merchant id known post-auth): one store's
  // content burst never eats another store's headroom.
  .use(tenantRateLimiter({ max: 600 }))
  .post('/content', async ({ auth, body }) => ContentService.create(auth.db, auth.merchant.id, body), { body: createBody })
  .put('/content/:id', async ({ auth, params, body }) => ContentService.update(auth.db, auth.merchant.id, params.id, body, auth.user.id), { body: pageBody })
  .get('/content/:id/versions', async ({ auth, params }) => ContentService.listVersions(auth.db, auth.merchant.id, params.id))
  .post('/content/:id/rollback/:version', async ({ auth, params }) =>
    ContentService.rollback(auth.db, auth.merchant.id, params.id, Number(params.version), auth.user.id)
  )
  .delete('/content/:id', async ({ auth, params }) => ContentService.delete(auth.db, auth.merchant.id, params.id))
