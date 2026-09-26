import { Elysia, t } from 'elysia'
import { authPlugin, hasPermission, requirePermission } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import type { AuthContext } from '../../plugins/auth'
import { forbidden } from '../../shared/errors'
import { auditFromRequest } from '../audit-logs'
import { ProductsService } from './service'
import {
  bulkEditBody,
  categoryBody,
  createProductBody,
  importCsvBody,
  productQuery,
  saveOptionsBody,
  updateProductBody,
  variantInput
} from './model'

/** Per-route read guard — a module-level `.use(requirePermission(...))` would
 *  stack onto the write routes below, so reads assert inline instead. */
const needProductRead = ({ auth }: { auth: AuthContext }) => {
  if (!hasPermission(auth, 'products.read')) throw forbidden()
}

export const productsModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'commerce' }))
  .get('/products', async ({ query, auth }) => ProductsService.list(auth.db, auth.merchant.id, query), {
    query: productQuery,
    beforeHandle: needProductRead
  })
  // registered before '/products/:id' so "export" is not captured as an id
  .get(
    '/products/export',
    async ({ auth, set, query }) => {
      const csv = await ProductsService.exportCsv(auth.db, auth.merchant.id, query)
      set.headers['content-type'] = 'text/csv; charset=utf-8'
      set.headers['content-disposition'] = `attachment; filename="products-${auth.merchant.slug}-${new Date().toISOString().slice(0, 10)}.csv"`
      return csv
    },
    { query: productQuery, detail: { summary: 'Export products as CSV (one row per variant, same filters as list)' }, beforeHandle: needProductRead }
  )
  // registered before '/products/:id' so "import/template" is not captured as an id
  .get(
    '/products/import/template',
    async ({ auth, set }) => {
      set.headers['content-type'] = 'text/csv; charset=utf-8'
      set.headers['content-disposition'] = 'attachment; filename="products-import-template.csv"'
      return ProductsService.csvTemplate()
    },
    { detail: { summary: 'Download a CSV import template (header row + sample)' }, beforeHandle: needProductRead }
  )
  .get('/products/:id', async ({ params, auth }) => ProductsService.get(auth.db, auth.merchant.id, params.id), {
    beforeHandle: needProductRead
  })
  .get('/products/:id/variants', async ({ params, auth }) =>
    ProductsService.listVariants(auth.db, auth.merchant.id, params.id),
    { beforeHandle: needProductRead }
  )
  .get('/products/:id/readiness', async ({ params, auth }) =>
    ProductsService.readiness(auth.db, auth.merchant.id, params.id),
    { beforeHandle: needProductRead }
  )
  .get('/products/:id/options', async ({ params, auth }) =>
    ProductsService.listOptions(auth.db, auth.merchant.id, params.id),
    { beforeHandle: needProductRead }
  )
  .get('/categories', async ({ auth }) => ProductsService.listCategories(auth.db, auth.merchant.id), {
    beforeHandle: needProductRead
  })
  .use(requirePermission('products.create', 'products.update', 'products.delete'))
  .post('/products', async ({ body, auth, request }) => {
    const result = await ProductsService.create(auth.db, auth.merchant.id, body)
    await auditFromRequest(auth, request, {
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
    const result = await ProductsService.bulkEdit(auth.db, auth.merchant.id, body)
    await auditFromRequest(auth, request, {
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
    async ({ body, auth, request, query }) => {
      const text = await body.file.text()
      const result = await ProductsService.importCsv(auth.db, auth.merchant.id, text, {
        dryRun: query?.dryRun === '1' || query?.dryRun === 'true'
      })
      if (!result.data.dryRun) {
        await auditFromRequest(auth, request, {
          action: 'product.import',
          entityType: 'product',
          metadata: { created: result.data.created, updated: result.data.updated }
        })
      }
      return result
    },
    {
      body: importCsvBody,
      query: t.Object({ dryRun: t.Optional(t.String()) }),
      detail: { summary: 'Import products from CSV (upsert by SKU). ?dryRun=1 validates only.' }
    }
  )
  .put(
    '/products/:id',
    async ({ params, body, auth, request }) => {
      const result = await ProductsService.update(auth.db, auth.merchant.id, params.id, body)
      await auditFromRequest(auth, request, {
        action: 'product.update',
        entityType: 'product',
        entityId: params.id
      })
      return result
    },
    { body: updateProductBody }
  )
  .delete('/products/:id', async ({ params, auth, request }) => {
    const result = await ProductsService.archive(auth.db, auth.merchant.id, params.id)
    await auditFromRequest(auth, request, {
      action: 'product.archive',
      entityType: 'product',
      entityId: params.id
    })
    return result
  })
  .post(
    '/products/:id/variants',
    async ({ params, body, auth, request }) => {
      const result = await ProductsService.addVariant(auth.db, auth.merchant.id, params.id, body)
      await auditFromRequest(auth, request, {
        action: 'variant.create',
        entityType: 'product',
        entityId: params.id
      })
      return result
    },
    { body: variantInput }
  )
  .put(
    '/products/:id/options',
    async ({ params, body, auth, request }) => {
      const result = await ProductsService.saveOptions(auth.db, auth.merchant.id, params.id, body.options)
      await auditFromRequest(auth, request, {
        action: 'product.options.update',
        entityType: 'product',
        entityId: params.id,
        metadata: { options: body.options.length }
      })
      return result
    },
    { body: saveOptionsBody }
  )
  .post(
    '/products/:id/variants/generate',
    async ({ params, auth, request }) => {
      const result = await ProductsService.generateVariants(auth.db, auth.merchant.id, params.id)
      await auditFromRequest(auth, request, {
        action: 'variant.generate',
        entityType: 'product',
        entityId: params.id,
        metadata: { created: result.data.created }
      })
      return result
    },
    { detail: { summary: 'Generate variant rows for the cartesian product of active option values' } }
  )
  .post('/categories', async ({ body, auth, request }) => {
    const result = await ProductsService.createCategory(auth.db, auth.merchant.id, body)
    await auditFromRequest(auth, request, {
      action: 'category.create',
      entityType: 'category',
      entityId: result.data.id,
      metadata: { name: body.name }
    })
    return result
  }, { body: categoryBody })
  .put('/categories/:id', async ({ params, body, auth, request }) => {
    const result = await ProductsService.updateCategory(auth.db, auth.merchant.id, params.id, body)
    await auditFromRequest(auth, request, {
      action: 'category.update',
      entityType: 'category',
      entityId: params.id
    })
    return result
  }, { body: categoryBody })
  .delete('/categories/:id', async ({ params, auth, request, query }) => {
    const result = await ProductsService.deleteCategory(auth.db, auth.merchant.id, params.id, query?.reassignTo ?? null)
    await auditFromRequest(auth, request, {
      action: 'category.delete',
      entityType: 'category',
      entityId: params.id
    })
    return result
  }, { query: t.Object({ reassignTo: t.Optional(t.String()) }) })
  .put('/variants/:id', async ({ params, body, auth, request }) => {
    const result = await ProductsService.updateVariant(auth.db, auth.merchant.id, params.id, body)
    await auditFromRequest(auth, request, {
      action: 'variant.update',
      entityType: 'product',
      entityId: params.id
    })
    return result
  }, { body: variantInput })
  .delete('/variants/:id', async ({ params, auth, request }) => {
    const result = await ProductsService.deleteVariant(auth.db, auth.merchant.id, params.id)
    await auditFromRequest(auth, request, {
      action: 'variant.delete',
      entityType: 'product',
      entityId: params.id
    })
    return result
  })
  .delete('/products/:id/variants/:variantId', async ({ params, auth, request, query }) => {
    const result = await ProductsService.deleteVariant(auth.db, auth.merchant.id, params.variantId, {
      productId: params.id,
      force: query?.force === '1' || query?.force === 'true'
    })
    await auditFromRequest(auth, request, {
      action: 'variant.delete',
      entityType: 'product',
      entityId: params.id,
      metadata: { variantId: params.variantId }
    })
    return result
  }, { query: t.Object({ force: t.Optional(t.String()) }) })