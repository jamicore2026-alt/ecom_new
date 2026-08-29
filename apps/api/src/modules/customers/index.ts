import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { CustomersService } from './service'
import { customerQuery, importCsvBody } from './model'

export const customersModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .get('/customers', async ({ query, auth }) => CustomersService.list(auth.merchant.id, query), {
    query: customerQuery
  })
  // registered before '/customers/:id' so "export" is not captured as an id
  .get(
    '/customers/export',
    async ({ auth, set }) => {
      const csv = await CustomersService.exportCsv(auth.merchant.id)
      set.headers['content-type'] = 'text/csv; charset=utf-8'
      set.headers['content-disposition'] = `attachment; filename="customers-${auth.merchant.slug}-${new Date().toISOString().slice(0, 10)}.csv"`
      return csv
    },
    { detail: { summary: 'Export customers as CSV' } }
  )
  .get('/customers/:id', async ({ params, auth }) => CustomersService.get(auth.merchant.id, params.id))
  .get('/customers/:id/orders', async ({ params, query, auth }) =>
    CustomersService.orders(auth.merchant.id, params.id, query), { query: customerQuery }
  )
  .use(requirePermission('customers.write'))
  .post(
    '/customers/import',
    async ({ body, auth, request }) => {
      const text = await body.file.text()
      const result = await CustomersService.importCsv(auth.merchant.id, text)
      auditFromRequest(auth, request, {
        action: 'customer.import',
        entityType: 'customer',
        metadata: { created: result.data.created, updated: result.data.updated }
      })
      return result
    },
    { body: importCsvBody, detail: { summary: 'Import customers from CSV (upsert by email)' } }
  )
