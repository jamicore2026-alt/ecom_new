import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { ProductsService } from './service'
import {
  bulkEditBody,
  categoryBody,
  createProductBody,
  importCsvBody,
  productQuery,
  updateProductBody,
  variantInput
} from './model'

export const productsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/products', async ({ query, auth }) => ProductsService.list(auth.merchant.id, query), {
    query: productQuery
  })
  // registered before '/products/:id' so "export" is not captured as an id
  .get(
    '/products/export',
    async ({ auth, set }) => {
      const csv = await ProductsService.exportCsv(auth.merchant.id)
      set.headers['content-type'] = 'text/csv; charset=utf-8'
      set.headers['content-disposition'] = `attachment; filename="products-${auth.merchant.slug}-${new Date().toISOString().slice(0, 10)}.csv"`
      return csv
    },
    { detail: { summary: 'Export products as CSV (one row per variant)' } }
  )
  .get('/products/:id', async ({ params, auth }) => ProductsService.get(auth.merchant.id, params.id))
  .get('/products/:id/variants', async ({ params, auth }) =>
    ProductsService.listVariants(auth.merchant.id, params.id)
  )
  .get('/categories', async ({ auth }) => ProductsService.listCategories(auth.merchant.id))
  .use(requirePermission('products:write'))
  .post('/products', async ({ body, auth, request }) => {
    const result = await ProductsService.create(auth.merchant.id, body)
    auditFromRequest(auth, request, {
      action: 'product.create',
      entityType: 'product',
      entityId: result.data.id,
      metadata: { name: body.name }
    })
    return result
  }, {
    body: createProductBody
  })
  .post('/products/bulk', async ({ body, auth, request }) => {
    const result = await ProductsService.bulkEdit(auth.merchant.id, body)
    auditFromRequest(auth, request, {
      action: 'product.bulk_edit',
      entityType: 'product',
      metadata: { count: body.ids?.length ?? 0 }
    })
    return result
  }, {
    body: bulkEditBody
  })
  .post(
    '/products/import',
    async ({ body, auth, request }) => {
      const text = await body.file.text()
      const result = await ProductsService.importCsv(auth.merchant.id, text)
      auditFromRequest(auth, request, {
        action: 'product.import',
        entityType: 'product',
        metadata: { created: result.data.created, updated: result.data.updated }
      })
      return result
    },
    { body: importCsvBody, detail: { summary: 'Import products from CSV (upsert by SKU)' } }
  )
  .put(
    '/products/:id',
    async ({ params, body, auth, request }) => {
      const result = await ProductsService.update(auth.merchant.id, params.id, body)
      auditFromRequest(auth, request, {
        action: 'product.update',
        entityType: 'product',
        entityId: params.id
      })
      return result
    },
    { body: updateProductBody }
  )
  .delete('/products/:id', async ({ params, auth, request }) => {
    const result = await ProductsService.archive(auth.merchant.id, params.id)
    auditFromRequest(auth, request, {
      action: 'product.archive',
      entityType: 'product',
      entityId: params.id
    })
    return result
  })
  .post(
    '/products/:id/variants',
    async ({ params, body, auth, request }) => {
      const result = await ProductsService.addVariant(auth.merchant.id, params.id, body)
      auditFromRequest(auth, request, {
        action: 'variant.create',
        entityType: 'product',
        entityId: params.id
      })
      return result
    },
    { body: variantInput }
  )
  .post('/categories', async ({ body, auth, request }) => {
    const result = await ProductsService.createCategory(auth.merchant.id, body)
    auditFromRequest(auth, request, {
      action: 'category.create',
      entityType: 'category',
      entityId: result.data.id,
      metadata: { name: body.name }
    })
    return result
  }, { body: categoryBody })
  .put('/categories/:id', async ({ params, body, auth, request }) => {
    const result = await ProductsService.updateCategory(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, {
      action: 'category.update',
      entityType: 'category',
      entityId: params.id
    })
    return result
  }, { body: categoryBody })
  .delete('/categories/:id', async ({ params, auth, request }) => {
    const result = await ProductsService.deleteCategory(auth.merchant.id, params.id)
    auditFromRequest(auth, request, {
      action: 'category.delete',
      entityType: 'category',
      entityId: params.id
    })
    return result
  })
  .put('/variants/:id', async ({ params, body, auth, request }) => {
    const result = await ProductsService.updateVariant(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, {
      action: 'variant.update',
      entityType: 'product',
      entityId: params.id
    })
    return result
  }, { body: variantInput })
  .delete('/variants/:id', async ({ params, auth, request }) => {
    const result = await ProductsService.deleteVariant(auth.merchant.id, params.id)
    auditFromRequest(auth, request, {
      action: 'variant.delete',
      entityType: 'product',
      entityId: params.id
    })
    return result
  })