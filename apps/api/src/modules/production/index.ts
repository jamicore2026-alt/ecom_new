import { Elysia, t } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { ProductionService } from './service'

const bomItemSchema = t.Object({
  variantId: t.String(),
  quantity: t.Integer({ minimum: 1 })
})

const bomBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  outputVariantId: t.String(),
  outputQuantity: t.Optional(t.Integer({ minimum: 1 })),
  notes: t.Optional(t.String()),
  items: t.Array(bomItemSchema, { minItems: 1 })
})

const bomUpdateBody = t.Partial(t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  notes: t.Optional(t.String()),
  status: t.Optional(t.String({ maxLength: 20 })),
  items: t.Optional(t.Array(bomItemSchema, { minItems: 1 }))
}))

const batchBody = t.Object({
  bomId: t.String(),
  quantity: t.Integer({ minimum: 1 }),
  notes: t.Optional(t.String())
})

const completeBody = t.Object({
  warehouseId: t.Optional(t.String())
})

const idParam = t.Object({ id: t.String() })

export const productionModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('inventory.read'))

  .get('/boms', async ({ auth, query }) => ProductionService.listBoms(auth.merchant.id, query))
  .get('/boms/:id', async ({ auth, params }) => ProductionService.getBom(auth.merchant.id, params.id), {
    params: idParam
  })
  .get('/production-orders', async ({ auth, query }) => ProductionService.listProductionOrders(auth.merchant.id, query))
  .get('/production-orders/:id', async ({ auth, params }) => ProductionService.getProductionOrder(auth.merchant.id, params.id), {
    params: idParam
  })

  .use(requirePermission('inventory.manage'))

  .post('/boms', async ({ auth, body }) => ProductionService.createBom(auth.merchant.id, body), {
    body: bomBody
  })
  .put('/boms/:id', async ({ auth, params, body }) => ProductionService.updateBom(auth.merchant.id, params.id, body), {
    params: idParam,
    body: bomUpdateBody
  })

  .post('/production-orders', async ({ auth, body }) => ProductionService.createProductionOrder(auth.merchant.id, body), {
    body: batchBody
  })
  .post('/production-orders/:id/start', async ({ auth, params }) =>
    ProductionService.transitionProductionOrder(auth.merchant.id, params.id, 'in_progress'), {
    params: idParam
  })
  .post('/production-orders/:id/complete', async ({ auth, params, body }) =>
    ProductionService.completeProduction(auth.merchant.id, params.id, body), {
    params: idParam,
    body: completeBody
  })
  .post('/production-orders/:id/cancel', async ({ auth, params }) =>
    ProductionService.transitionProductionOrder(auth.merchant.id, params.id, 'cancelled'), {
    params: idParam
  })