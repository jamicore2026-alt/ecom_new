import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { CustomersService } from './service'
import { customerCreateBody, customerOptOutBody, customerQuery, customerUpdateBody, importCsvBody } from './model'

export const customersModule = new Elysia({ prefix: '/api' })
  // NOTE (module gating, task 11): deliberately NO outletGuard({module}) here.
  // Customers are shared across commerce + restaurant (food/POS) flows, so no
  // single module fits — gating to 'commerce' would lock out restaurant-only
  // merchants. Permission gating (customers.write below; reads require an
  // authenticated session) stays as-is.
  .use(authPlugin)
  .get('/customers', async ({ query, auth }) => CustomersService.list(auth.db, auth.merchant.id, query), {
    query: customerQuery
  })
  // registered before '/customers/:id' so "export" is not captured as an id
  .get(
    '/customers/export',
    async ({ auth, set }) => {
      const csv = await CustomersService.exportCsv(auth.db, auth.merchant.id)
      set.headers['content-type'] = 'text/csv; charset=utf-8'
      set.headers['content-disposition'] = `attachment; filename="customers-${auth.merchant.slug}-${new Date().toISOString().slice(0, 10)}.csv"`
      return csv
    },
    { detail: { summary: 'Export customers as CSV' } }
  )
  .get('/customers/:id', async ({ params, auth }) => CustomersService.get(auth.db, auth.merchant.id, params.id))
  .get('/customers/:id/orders', async ({ params, query, auth }) =>
    CustomersService.orders(auth.db, auth.merchant.id, params.id, query), { query: customerQuery }
  )
  .use(requirePermission('customers.write'))
  .post(
    '/customers',
    async ({ body, auth, request }) => {
      const result = await CustomersService.create(auth.db, auth.merchant.id, body)
      await auditFromRequest(auth, request, {
        action: 'customer.create',
        entityType: 'customer',
        entityId: result.data.id
      })
      return result
    },
    { body: customerCreateBody, detail: { summary: 'Create a customer manually' } }
  )
  .put(
    '/customers/:id',
    async ({ params, body, auth, request }) => {
      const result = await CustomersService.update(auth.db, auth.merchant.id, params.id, body)
      await auditFromRequest(auth, request, {
        action: 'customer.update',
        entityType: 'customer',
        entityId: params.id
      })
      return result
    },
    { body: customerUpdateBody, detail: { summary: 'Update a customer manually' } }
  )
  .delete('/customers/:id', async ({ params, auth, request }) => {
    const result = await CustomersService.remove(auth.db, auth.merchant.id, params.id)
    await auditFromRequest(auth, request, {
      action: 'customer.delete',
      entityType: 'customer',
      entityId: params.id
    })
    return result
  }, { detail: { summary: 'Delete a customer (blocked when orders exist)' } })
  .post(
    '/customers/:id/opt-out',
    async ({ params, body, auth, request }) => {
      const result = await CustomersService.setOptOut(auth.db, auth.merchant.id, params.id, body.marketingOptOut)
      await auditFromRequest(auth, request, {
        action: 'customer.opt_out',
        entityType: 'customer',
        entityId: params.id,
        metadata: { marketingOptOut: body.marketingOptOut }
      })
      return result
    },
    { body: customerOptOutBody, detail: { summary: 'Toggle marketing opt-out for a customer' } }
  )
  .post(
    '/customers/import',
    async ({ body, auth, request }) => {
      const text = await body.file.text()
      const result = await CustomersService.importCsv(auth.db, auth.merchant.id, text)
      await auditFromRequest(auth, request, {
        action: 'customer.import',
        entityType: 'customer',
        metadata: { created: result.data.created, updated: result.data.updated }
      })
      return result
    },
    { body: importCsvBody, detail: { summary: 'Import customers from CSV (upsert by email)' } }
  )
