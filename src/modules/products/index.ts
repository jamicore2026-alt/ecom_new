import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { ProductsService } from './service'
import {
  bulkEditBody,
  categoryBody,
  createProductBody,
  productQuery,
  updateProductBody,
  variantInput
} from './model'

export const productsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/products', async ({ query, auth }) => ProductsService.list(auth.merchant.id, query), {
    query: productQuery
  })
  .get('/products/:id', async ({ params, auth }) => ProductsService.get(auth.merchant.id, params.id))
  .get('/products/:id/variants', async ({ params, auth }) =>
    ProductsService.listVariants(auth.merchant.id, params.id)
  )
  .get('/categories', async ({ auth }) => ProductsService.listCategories(auth.merchant.id))
  .use(requirePermission('products:write'))
  .post('/products', async ({ body, auth }) => ProductsService.create(auth.merchant.id, body), {
    body: createProductBody
  })
  .post('/products/bulk', async ({ body, auth }) => ProductsService.bulkEdit(auth.merchant.id, body), {
    body: bulkEditBody
  })
  .put(
    '/products/:id',
    async ({ params, body, auth }) => ProductsService.update(auth.merchant.id, params.id, body),
    { body: updateProductBody }
  )
  .delete('/products/:id', async ({ params, auth }) =>
    ProductsService.archive(auth.merchant.id, params.id)
  )
  .post(
    '/products/:id/variants',
    async ({ params, body, auth }) => ProductsService.addVariant(auth.merchant.id, params.id, body),
    { body: variantInput }
  )
  .post('/categories', async ({ body, auth }) =>
    ProductsService.createCategory(auth.merchant.id, body), { body: categoryBody }
  )
  .put('/categories/:id', async ({ params, body, auth }) =>
    ProductsService.updateCategory(auth.merchant.id, params.id, body), { body: categoryBody }
  )
  .delete('/categories/:id', async ({ params, auth }) =>
    ProductsService.deleteCategory(auth.merchant.id, params.id)
  )
  .put('/variants/:id', async ({ params, body, auth }) =>
    ProductsService.updateVariant(auth.merchant.id, params.id, body), { body: variantInput }
  )
  .delete('/variants/:id', async ({ params, auth }) =>
    ProductsService.deleteVariant(auth.merchant.id, params.id)
  )