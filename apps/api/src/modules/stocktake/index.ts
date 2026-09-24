import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { StocktakeService } from './service'
import { addItemBody, createSessionBody, itemParams, sessionParams, setCountBody } from './model'

export const stocktakeModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'inventory' }))
  .use(requirePermission('inventory.read'))
  .get('/stocktake/sessions', async ({ auth, query }) => StocktakeService.list(auth.db, auth.merchant.id, query))
  .get('/stocktake/sessions/:id', async ({ auth, params }) => StocktakeService.get(auth.db, auth.merchant.id, params.id), {
    params: sessionParams
  })
  .use(requirePermission('inventory.manage'))
  .post('/stocktake/sessions', async ({ auth, body }) => StocktakeService.create(auth.db, auth.merchant.id, auth.user.id, body), {
    body: createSessionBody
  })
  .post('/stocktake/sessions/:id/items', async ({ auth, params, body }) => StocktakeService.addItem(auth.db, auth.merchant.id, params.id, body), {
    params: sessionParams,
    body: addItemBody
  })
  .put('/stocktake/sessions/:id/items/:itemId', async ({ auth, params, body }) =>
    StocktakeService.setCount(auth.db, auth.merchant.id, params.id, params.itemId, body.countedQuantity), {
    params: itemParams,
    body: setCountBody
  })
  .post('/stocktake/sessions/:id/submit', async ({ auth, params }) => StocktakeService.submit(auth.db, auth.merchant.id, params.id), {
    params: sessionParams
  })
  .post('/stocktake/sessions/:id/approve', async ({ auth, params }) => StocktakeService.approve(auth.db, auth.merchant.id, params.id, auth.user.id), {
    params: sessionParams
  })
