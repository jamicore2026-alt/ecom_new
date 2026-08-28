import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import {
  TableSectionsService,
  TablesService,
  TablesSessionService,
  TableQrService
} from './service'
import {
  tableParams,
  tableQuery,
  tableSectionBody,
  tableSectionUpdateBody,
  tableCreateBody,
  tableUpdateBody,
  tableStatusBody,
  sessionOpenBody,
  sessionMoveBody,
  sessionMergeBody,
  sessionSplitBody,
  sessionOrderAttachBody,
  sessionQuery,
  qrUrlBody
} from './model'

export const tablesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'tables', permissions: ['tables.read'] }))
  .get('/table-sections', async ({ auth }) => TableSectionsService.list(auth.merchant.id), {
    detail: { summary: 'List table sections' }
  })
  .get('/tables', async ({ query, auth }) => TablesService.list(auth.merchant.id, query), {
    query: tableQuery,
    detail: { summary: 'List tables (floor view)' }
  })
  .get('/tables/:id', async ({ params, auth }) => TablesService.get(auth.merchant.id, params.id), {
    params: tableParams,
    detail: { summary: 'Get a table' }
  })
  .get('/table-sessions', async ({ query, auth }) => TablesSessionService.list(auth.merchant.id, query), {
    query: sessionQuery,
    detail: { summary: 'List table sessions' }
  })
  .get('/table-sessions/:id', async ({ params, auth }) => TablesSessionService.get(auth.merchant.id, params.id), {
    params: tableParams,
    detail: { summary: 'Get a table session' }
  })
  .get('/tables/:id/qr', async ({ params, auth, query }) =>
    TablesService.qr(auth.merchant.id, params.id, query.baseUrl), {
    params: tableParams,
    query: qrUrlBody,
    detail: { summary: 'Get a table QR token + URL' }
  })

  .use(outletGuard({ module: 'tables', permissions: ['tables.manage'] }))
  .post('/table-sections', async ({ body, auth, request }) => {
    const result = await TableSectionsService.create(auth.merchant.id, body)
    auditFromRequest(auth, request, { action: 'table_section.create', entityType: 'table_section', entityId: (result.data as { id: string }).id })
    return result
  }, { body: tableSectionBody })
  .put('/table-sections/:id', async ({ params, body, auth, request }) => {
    const result = await TableSectionsService.update(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'table_section.update', entityType: 'table_section', entityId: params.id })
    return result
  }, { params: tableParams, body: tableSectionUpdateBody })
  .delete('/table-sections/:id', async ({ params, auth, request }) => {
    const result = await TableSectionsService.remove(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'table_section.delete', entityType: 'table_section', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/tables', async ({ body, auth, request }) => {
    const result = await TablesService.create(auth.merchant.id, body)
    auditFromRequest(auth, request, { action: 'table.create', entityType: 'table', entityId: (result.data as { id: string }).id })
    return result
  }, { body: tableCreateBody })
  .put('/tables/:id', async ({ params, body, auth, request }) => {
    const result = await TablesService.update(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'table.update', entityType: 'table', entityId: params.id })
    return result
  }, { params: tableParams, body: tableUpdateBody })
  .delete('/tables/:id', async ({ params, auth, request }) => {
    const result = await TablesService.remove(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'table.delete', entityType: 'table', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/tables/:id/status', async ({ params, body, auth, request }) => {
    const result = await TablesService.status(auth.merchant.id, params.id, body.status)
    auditFromRequest(auth, request, { action: 'table.status', entityType: 'table', entityId: params.id, metadata: { status: body.status } })
    return result
  }, { params: tableParams, body: tableStatusBody })
  .post('/table-sessions', async ({ body, auth, merchantContext, request }) => {
    const result = await TablesSessionService.open(auth.merchant.id, body, merchantContext.selectedOutlet?.id)
    auditFromRequest(auth, request, { action: 'table_session.open', entityType: 'table_session', entityId: (result.data as { id: string }).id, metadata: { tableId: body.tableId } })
    return result
  }, { body: sessionOpenBody })
  .post('/table-sessions/:id/close', async ({ params, auth, request }) => {
    const result = await TablesSessionService.close(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'table_session.close', entityType: 'table_session', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/table-sessions/:id/cancel', async ({ params, auth, request }) => {
    const result = await TablesSessionService.cancel(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'table_session.cancel', entityType: 'table_session', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/table-sessions/:id/move', async ({ params, body, auth, request }) => {
    const result = await TablesSessionService.move(auth.merchant.id, params.id, body.toTableId)
    auditFromRequest(auth, request, { action: 'table_session.move', entityType: 'table_session', entityId: params.id, metadata: { toTableId: body.toTableId } })
    return result
  }, { params: tableParams, body: sessionMoveBody })
  .post('/table-sessions/:id/merge', async ({ params, body, auth, request }) => {
    const result = await TablesSessionService.merge(auth.merchant.id, params.id, body.sessionIds)
    auditFromRequest(auth, request, { action: 'table_session.merge', entityType: 'table_session', entityId: params.id, metadata: { sessionIds: body.sessionIds } })
    return result
  }, { params: tableParams, body: sessionMergeBody })
  .post('/table-sessions/:id/split', async ({ params, body, auth, request }) => {
    const result = await TablesSessionService.split(auth.merchant.id, params.id, body.toTableId, body.guests)
    auditFromRequest(auth, request, { action: 'table_session.split', entityType: 'table_session', entityId: params.id, metadata: { toTableId: body.toTableId, guests: body.guests } })
    return result
  }, { params: tableParams, body: sessionSplitBody })
  .post('/table-sessions/:id/orders', async ({ params, body, auth, request }) => {
    const result = await TablesSessionService.attachOrder(auth.merchant.id, params.id, body.orderId)
    auditFromRequest(auth, request, { action: 'table_session.attach_order', entityType: 'table_session', entityId: params.id, metadata: { orderId: body.orderId } })
    return result
  }, { params: tableParams, body: sessionOrderAttachBody })

/** Public QR table context — NO auth, exposes only table name + outlet + public menu. */
export const tableQrModule = new Elysia({ prefix: '/api' })
  .get('/table-qr/:token', async ({ params }) => TableQrService.context(params.token), {
    detail: { summary: 'Public table QR context (no auth)' }
  })
