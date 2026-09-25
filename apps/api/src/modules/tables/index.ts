import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { db } from '../../database/client'
import {
  TableSectionsService,
  TablesService,
  TablesSessionService,
  ReservationsService,
  TurnTimeService,
  TableQrService
} from './service'
import {
  tableParams,
  tableQuery,
  tableSectionBody,
  tableSectionUpdateBody,
  tableCreateBody,
  tableUpdateBody,
  tablePositionBody,
  tableStatusBody,
  sessionOpenBody,
  sessionMoveBody,
  sessionMergeBody,
  sessionSplitBody,
  sessionOrderAttachBody,
  sessionQuery,
  qrUrlBody,
  reservationCreateBody,
  reservationUpdateBody,
  reservationStatusBody,
  reservationAssignBody,
  reservationQuery,
  reservationHistoryQuery,
  turnTimeQuery
} from './model'

export const tablesModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'tables', permissions: ['tables.read'] }))
  .get('/table-sections', async ({ auth, merchantContext }) => TableSectionsService.list(auth.db, auth.merchant.id, merchantContext), {
    detail: { summary: 'List table sections' }
  })
  .get('/tables', async ({ query, auth, merchantContext }) => TablesService.list(auth.db, auth.merchant.id, query, merchantContext), {
    query: tableQuery,
    detail: { summary: 'List tables (floor view)' }
  })
  .get('/tables/:id', async ({ params, auth, merchantContext }) => TablesService.get(auth.db, auth.merchant.id, params.id, merchantContext), {
    params: tableParams,
    detail: { summary: 'Get a table' }
  })
  .get('/table-sessions', async ({ query, auth, merchantContext }) => TablesSessionService.list(auth.db, auth.merchant.id, query, merchantContext), {
    query: sessionQuery,
    detail: { summary: 'List table sessions' }
  })
  .get('/table-sessions/:id', async ({ params, auth, merchantContext }) => TablesSessionService.get(auth.db, auth.merchant.id, params.id, merchantContext), {
    params: tableParams,
    detail: { summary: 'Get a table session' }
  })
  .get('/tables/:id/qr', async ({ params, auth, query, merchantContext }) =>
    TablesService.qr(auth.db, auth.merchant.id, params.id, query.baseUrl, merchantContext), {
    params: tableParams,
    query: qrUrlBody,
    detail: { summary: 'Get a table QR token + URL' }
  })
  .get('/reservations/waitlist', async ({ query, auth, merchantContext }) => ReservationsService.waitlist(auth.db, auth.merchant.id, query, merchantContext), {
    query: tableQuery,
    detail: { summary: 'Waitlist (status=waitlist, FIFO)' }
  })
  .get('/reservations/history', async ({ query, auth, merchantContext }) => ReservationsService.history(auth.db, auth.merchant.id, query.phone, merchantContext), {
    query: reservationHistoryQuery,
    detail: { summary: 'Guest history by phone' }
  })
  .get('/reservations', async ({ query, auth, merchantContext }) => ReservationsService.list(auth.db, auth.merchant.id, query, merchantContext), {
    query: reservationQuery,
    detail: { summary: 'List reservations (outlet-scoped, day filter)' }
  })
  .get('/reservations/:id', async ({ params, auth, merchantContext }) => ReservationsService.get(auth.db, auth.merchant.id, params.id, merchantContext), {
    params: tableParams,
    detail: { summary: 'Get a reservation' }
  })
  .get('/tables/reports/turn-time', async ({ query, auth, merchantContext }) => TurnTimeService.report(auth.db, auth.merchant.id, query, merchantContext), {
    query: turnTimeQuery,
    detail: { summary: 'Turn-time report: avg/median open→close minutes per outlet/section' }
  })

  .use(outletGuard({ module: 'tables', permissions: ['tables.manage'] }))
  .post('/table-sections', async ({ body, auth, request, merchantContext }) => {
    const result = await TableSectionsService.create(auth.db, auth.merchant.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_section.create', entityType: 'table_section', entityId: (result.data as { id: string }).id })
    return result
  }, { body: tableSectionBody })
  .put('/table-sections/:id', async ({ params, body, auth, request, merchantContext }) => {
    const result = await TableSectionsService.update(auth.db, auth.merchant.id, params.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_section.update', entityType: 'table_section', entityId: params.id })
    return result
  }, { params: tableParams, body: tableSectionUpdateBody })
  .delete('/table-sections/:id', async ({ params, auth, request, merchantContext }) => {
    const result = await TableSectionsService.remove(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_section.delete', entityType: 'table_section', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/tables', async ({ body, auth, request, merchantContext }) => {
    const result = await TablesService.create(auth.db, auth.merchant.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'table.create', entityType: 'table', entityId: (result.data as { id: string }).id })
    return result
  }, { body: tableCreateBody })
  .put('/tables/:id', async ({ params, body, auth, request, merchantContext }) => {
    const result = await TablesService.update(auth.db, auth.merchant.id, params.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'table.update', entityType: 'table', entityId: params.id })
    return result
  }, { params: tableParams, body: tableUpdateBody })
  .delete('/tables/:id', async ({ params, auth, request, merchantContext }) => {
    const result = await TablesService.remove(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'table.delete', entityType: 'table', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/tables/:id/status', async ({ params, body, auth, request, merchantContext }) => {
    const result = await TablesService.status(auth.db, auth.merchant.id, params.id, body.status, merchantContext)
    await auditFromRequest(auth, request, { action: 'table.status', entityType: 'table', entityId: params.id, metadata: { status: body.status } })
    return result
  }, { params: tableParams, body: tableStatusBody })
  .post('/table-sessions', async ({ body, auth, merchantContext, request }) => {
    const result = await TablesSessionService.open(auth.db, auth.merchant.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_session.open', entityType: 'table_session', entityId: (result.data as { id: string }).id, metadata: { tableId: body.tableId } })
    return result
  }, { body: sessionOpenBody })
  .post('/table-sessions/:id/close', async ({ params, auth, request, merchantContext }) => {
    const result = await TablesSessionService.close(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_session.close', entityType: 'table_session', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/table-sessions/:id/cancel', async ({ params, auth, request, merchantContext }) => {
    const result = await TablesSessionService.cancel(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_session.cancel', entityType: 'table_session', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/table-sessions/:id/move', async ({ params, body, auth, request, merchantContext }) => {
    const result = await TablesSessionService.move(auth.db, auth.merchant.id, params.id, body.toTableId, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_session.move', entityType: 'table_session', entityId: params.id, metadata: { toTableId: body.toTableId } })
    return result
  }, { params: tableParams, body: sessionMoveBody })
  .post('/table-sessions/:id/merge', async ({ params, body, auth, request, merchantContext }) => {
    const result = await TablesSessionService.merge(auth.db, auth.merchant.id, params.id, body.sessionIds, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_session.merge', entityType: 'table_session', entityId: params.id, metadata: { sessionIds: body.sessionIds } })
    return result
  }, { params: tableParams, body: sessionMergeBody })
  .post('/table-sessions/:id/split', async ({ params, body, auth, request, merchantContext }) => {
    const result = await TablesSessionService.split(auth.db, auth.merchant.id, params.id, body.toTableId, body.guests, merchantContext, body.orderItemIds)
    await auditFromRequest(auth, request, { action: 'table_session.split', entityType: 'table_session', entityId: params.id, metadata: { toTableId: body.toTableId, guests: body.guests, orderItemIds: body.orderItemIds ?? [] } })
    return result
  }, { params: tableParams, body: sessionSplitBody })
  .put('/tables/:id/position', async ({ params, body, auth, request, merchantContext }) => {
    const result = await TablesService.setPosition(auth.db, auth.merchant.id, params.id, body.posX, body.posY, merchantContext)
    await auditFromRequest(auth, request, { action: 'table.position', entityType: 'table', entityId: params.id, metadata: { posX: body.posX, posY: body.posY } })
    return result
  }, { params: tableParams, body: tablePositionBody })
  .post('/reservations', async ({ body, auth, request, merchantContext }) => {
    const result = await ReservationsService.create(auth.db, auth.merchant.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'reservation.create', entityType: 'reservation', entityId: (result.data as { id: string }).id })
    return result
  }, { body: reservationCreateBody })
  .put('/reservations/:id', async ({ params, body, auth, request, merchantContext }) => {
    const result = await ReservationsService.update(auth.db, auth.merchant.id, params.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'reservation.update', entityType: 'reservation', entityId: params.id })
    return result
  }, { params: tableParams, body: reservationUpdateBody })
  .post('/reservations/:id/status', async ({ params, body, auth, request, merchantContext }) => {
    const result = await ReservationsService.setStatus(auth.db, auth.merchant.id, params.id, body.status, merchantContext)
    await auditFromRequest(auth, request, { action: 'reservation.status', entityType: 'reservation', entityId: params.id, metadata: { status: body.status } })
    return result
  }, { params: tableParams, body: reservationStatusBody })
  .post('/reservations/:id/assign', async ({ params, body, auth, request, merchantContext }) => {
    const result = await ReservationsService.assignTable(auth.db, auth.merchant.id, params.id, body.tableId, merchantContext)
    await auditFromRequest(auth, request, { action: 'reservation.assign', entityType: 'reservation', entityId: params.id, metadata: { tableId: body.tableId } })
    return result
  }, { params: tableParams, body: reservationAssignBody })
  .delete('/reservations/:id', async ({ params, auth, request, merchantContext }) => {
    const result = await ReservationsService.remove(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'reservation.delete', entityType: 'reservation', entityId: params.id })
    return result
  }, { params: tableParams })
  .post('/table-sessions/:id/orders', async ({ params, body, auth, request, merchantContext }) => {
    const result = await TablesSessionService.attachOrder(auth.db, auth.merchant.id, params.id, body.orderId, merchantContext)
    await auditFromRequest(auth, request, { action: 'table_session.attach_order', entityType: 'table_session', entityId: params.id, metadata: { orderId: body.orderId } })
    return result
  }, { params: tableParams, body: sessionOrderAttachBody })

/** Public QR table context — NO auth, exposes only table name + outlet + public menu. */
export const tableQrModule = new Elysia({ prefix: '/api' })
  .get('/table-qr/:token', async ({ params }) => TableQrService.context(db, params.token), {
    detail: { summary: 'Public table QR context (no auth)' }
  })
