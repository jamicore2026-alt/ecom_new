import { Elysia, t } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import {
  KitchenStationsService,
  KitchenTicketsService,
  KdsBoardService
} from './service'
import {
  kitchenParams,
  kitchenStationBody,
  kitchenStationUpdateBody,
  kitchenStationQuery,
  kotStatusBody,
  kotItemStatusBody,
  kotTicketQuery,
  kotGenerateBody,
  kotPriorityBody
} from './model'

const ticketItemParams = t.Object({ id: t.String(), itemId: t.String() })
const orderParams = t.Object({ id: t.String() })

/* Read side: stations + tickets. Permission `kitchen.read`. */
export const kitchenModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'kitchen', permissions: ['kitchen.read'] }))
  .get('/kitchen-stations', async ({ query, auth }) => KitchenStationsService.list(auth.merchant.id, query), {
    query: kitchenStationQuery,
    detail: { summary: 'List kitchen stations' }
  })
  .get('/kitchen-stations/:id', async ({ params, auth }) => KitchenStationsService.get(auth.merchant.id, params.id), {
    params: kitchenParams,
    detail: { summary: 'Get a kitchen station' }
  })
  .get('/kitchen/tickets', async ({ query, auth }) => KitchenTicketsService.list(auth.merchant.id, query), {
    query: kotTicketQuery,
    detail: { summary: 'List kitchen tickets (KOT)' }
  })
  .get('/kitchen/kds', async ({ query, auth }) => KdsBoardService.board(auth.merchant.id, query), {
    query: kitchenStationQuery,
    detail: { summary: 'KDS display board grouped by station' }
  })
  .get('/kitchen/tickets/:id', async ({ params, auth }) => KitchenTicketsService.get(auth.merchant.id, params.id), {
    params: kitchenParams,
    detail: { summary: 'Get a kitchen ticket with items' }
  })

  /* Station management: permission `kitchen.manage`. */
  .use(outletGuard({ module: 'kitchen', permissions: ['kitchen.manage'] }))
  .post('/kitchen-stations', async ({ body, auth, request }) => {
    const result = await KitchenStationsService.create(auth.merchant.id, body)
    auditFromRequest(auth, request, { action: 'kitchen_station.create', entityType: 'kitchen_station', entityId: (result.data as { id: string }).id })
    return result
  }, { body: kitchenStationBody })
  .put('/kitchen-stations/:id', async ({ params, body, auth, request }) => {
    const result = await KitchenStationsService.update(auth.merchant.id, params.id, body)
    auditFromRequest(auth, request, { action: 'kitchen_station.update', entityType: 'kitchen_station', entityId: params.id })
    return result
  }, { params: kitchenParams, body: kitchenStationUpdateBody })
  .delete('/kitchen-stations/:id', async ({ params, auth, request }) => {
    const result = await KitchenStationsService.remove(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'kitchen_station.delete', entityType: 'kitchen_station', entityId: params.id })
    return result
  }, { params: kitchenParams })

  /* Ticket actions: `kitchen.manage` OR `kds.manage` (kitchen staff may work the board). */
  .use(outletGuard({ module: 'kitchen', permissions: ['kitchen.manage', 'kds.manage'] }))
  .post('/kitchen/orders/:id/tickets', async ({ params, body, auth, request }) => {
    const result = await KitchenTicketsService.generateForOrder(auth.merchant.id, params.id, body.priority)
    auditFromRequest(auth, request, { action: 'kot.generate', entityType: 'kitchen_ticket', entityId: params.id, metadata: { priority: body.priority } })
    return result
  }, { params: orderParams, body: kotGenerateBody })
  .post('/kitchen/tickets/:id/status', async ({ params, body, auth, request }) => {
    const result = await KitchenTicketsService.transition(auth.merchant.id, params.id, body.status)
    auditFromRequest(auth, request, { action: 'kot.status', entityType: 'kitchen_ticket', entityId: params.id, metadata: { status: body.status } })
    return result
  }, { params: kitchenParams, body: kotStatusBody })
  .post('/kitchen/tickets/:id/bump', async ({ params, auth, request }) => {
    const result = await KitchenTicketsService.bump(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'kot.bump', entityType: 'kitchen_ticket', entityId: params.id })
    return result
  }, { params: kitchenParams })
  .post('/kitchen/tickets/:id/recall', async ({ params, auth, request }) => {
    const result = await KitchenTicketsService.recall(auth.merchant.id, params.id)
    auditFromRequest(auth, request, { action: 'kot.recall', entityType: 'kitchen_ticket', entityId: params.id })
    return result
  }, { params: kitchenParams })
  .put('/kitchen/tickets/:id/priority', async ({ params, body, auth, request }) => {
    const result = await KitchenTicketsService.setPriority(auth.merchant.id, params.id, body.priority)
    auditFromRequest(auth, request, { action: 'kot.priority', entityType: 'kitchen_ticket', entityId: params.id, metadata: { priority: body.priority } })
    return result
  }, { params: kitchenParams, body: kotPriorityBody })
  .post('/kitchen/tickets/:id/items/:itemId/status', async ({ params, body, auth, request }) => {
    const result = await KitchenTicketsService.itemStatus(auth.merchant.id, params.id, params.itemId, body.status)
    auditFromRequest(auth, request, { action: 'kot.item.status', entityType: 'kitchen_ticket', entityId: params.id, metadata: { itemId: params.itemId, status: body.status } })
    return result
  }, { params: ticketItemParams, body: kotItemStatusBody })
