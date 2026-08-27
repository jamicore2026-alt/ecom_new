import { Elysia } from 'elysia'
import { t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { ContentService } from './service'

const pageBody = t.Object({
  title: t.Optional(t.String({ minLength: 1 })),
  slug: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  content: t.Optional(t.String()),
  status: t.Optional(t.Union([t.Literal('draft'), t.Literal('published'), t.Literal('archived')])),
  metaTitle: t.Optional(t.String()),
  metaDescription: t.Optional(t.String())
})

const createBody = t.Object({
  title: t.String({ minLength: 1 }),
  slug: t.String({ minLength: 1, maxLength: 255 }),
  content: t.Optional(t.String()),
  status: t.Optional(t.Union([t.Literal('draft'), t.Literal('published'), t.Literal('archived')]))
})

export const contentModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/content', async ({ auth }) => ContentService.list(auth.merchant.id))
  .get('/content/:id', async ({ auth, params }) => ContentService.get(auth.merchant.id, params.id))

  .use(requirePermission('products:write'))
  .post('/content', async ({ auth, body }) => ContentService.create(auth.merchant.id, body), { body: createBody })
  .put('/content/:id', async ({ auth, params, body }) => ContentService.update(auth.merchant.id, params.id, body), { body: pageBody })
  .delete('/content/:id', async ({ auth, params }) => ContentService.delete(auth.merchant.id, params.id))
