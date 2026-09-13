import { Elysia } from 'elysia'
import { authPlugin } from '../../plugins/auth'
import { outletGuard } from '../../plugins/outlet'
import { auditFromRequest } from '../audit-logs'
import { DeliveryZonesService, DriversService, DeliveryOrdersService } from './service'
import {
  deliveryParams,
  deliveryZoneBody,
  deliveryZoneUpdateBody,
  deliveryZoneQuery,
  driverBody,
  driverUpdateBody,
  driverQuery,
  deliveryQuery,
  deliveryCreateBody,
  deliveryAssignBody,
  deliveryTransitionBody,
  driverTransitionBody,
  driverMeBody
} from './model'

/* Read side: zones + drivers + deliveries. Permissions delivery.read / drivers.read. */
export const deliveryModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'delivery', permissions: ['delivery.read', 'drivers.read'] }))
  .get('/delivery-zones', async ({ query, auth, merchantContext }) => DeliveryZonesService.list(auth.db, auth.merchant.id, query, merchantContext), {
    query: deliveryZoneQuery,
    detail: { summary: 'List delivery zones' }
  })
  .get('/delivery-zones/:id', async ({ params, auth, merchantContext }) => DeliveryZonesService.get(auth.db, auth.merchant.id, params.id, merchantContext), {
    params: deliveryParams,
    detail: { summary: 'Get a delivery zone' }
  })
  .get('/drivers', async ({ query, auth }) => DriversService.list(auth.db, auth.merchant.id, query), {
    query: driverQuery,
    detail: { summary: 'List drivers' }
  })
  .get('/drivers/:id', async ({ params, auth }) => DriversService.get(auth.db, auth.merchant.id, params.id), {
    params: deliveryParams,
    detail: { summary: 'Get a driver' }
  })
  .get('/deliveries', async ({ query, auth, merchantContext }) => DeliveryOrdersService.list(auth.db, auth.merchant.id, query, merchantContext), {
    query: deliveryQuery,
    detail: { summary: 'List delivery orders' }
  })
  .get('/deliveries/:id', async ({ params, auth, merchantContext }) => DeliveryOrdersService.get(auth.db, auth.merchant.id, params.id, merchantContext), {
    params: deliveryParams,
    detail: { summary: 'Get a delivery order' }
  })

  /* Zone management: delivery.manage. */
  .use(outletGuard({ module: 'delivery', permissions: ['delivery.manage'] }))
  .post('/delivery-zones', async ({ body, auth, request, merchantContext }) => {
    const result = await DeliveryZonesService.create(auth.db, auth.merchant.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'delivery_zone.create', entityType: 'delivery_zone', entityId: (result.data as { id: string }).id })
    return result
  }, { body: deliveryZoneBody })
  .put('/delivery-zones/:id', async ({ params, body, auth, request, merchantContext }) => {
    const result = await DeliveryZonesService.update(auth.db, auth.merchant.id, params.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'delivery_zone.update', entityType: 'delivery_zone', entityId: params.id })
    return result
  }, { params: deliveryParams, body: deliveryZoneUpdateBody })
  .delete('/delivery-zones/:id', async ({ params, auth, request, merchantContext }) => {
    const result = await DeliveryZonesService.remove(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'delivery_zone.delete', entityType: 'delivery_zone', entityId: params.id })
    return result
  }, { params: deliveryParams })

  /* Driver management: drivers.manage. */
  .use(outletGuard({ module: 'delivery', permissions: ['drivers.manage'] }))
  .post('/drivers', async ({ body, auth, request, merchantContext }) => {
    const result = await DriversService.create(auth.db, auth.merchant.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'driver.create', entityType: 'driver', entityId: (result.data as { id: string }).id })
    return result
  }, { body: driverBody })
  .put('/drivers/:id', async ({ params, body, auth, request, merchantContext }) => {
    const result = await DriversService.update(auth.db, auth.merchant.id, params.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'driver.update', entityType: 'driver', entityId: params.id })
    return result
  }, { params: deliveryParams, body: driverUpdateBody })
  .delete('/drivers/:id', async ({ params, auth, request, merchantContext }) => {
    const result = await DriversService.remove(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'driver.delete', entityType: 'driver', entityId: params.id })
    return result
  }, { params: deliveryParams })
  .post('/drivers/:id/status', async ({ params, body, auth, request, merchantContext }) => {
    const result = await DriversService.setStatus(auth.db, auth.merchant.id, params.id, body.status, undefined, merchantContext)
    await auditFromRequest(auth, request, { action: 'driver.status', entityType: 'driver', entityId: params.id, metadata: { status: body.status } })
    return result
  }, { params: deliveryParams, body: driverTransitionBody })

  /* Delivery creation + dispatch: delivery.assign. */
  .use(outletGuard({ module: 'delivery', permissions: ['delivery.assign'] }))
  .post('/deliveries', async ({ body, auth, request, merchantContext }) => {
    const result = await DeliveryOrdersService.create(auth.db, auth.merchant.id, body, merchantContext)
    await auditFromRequest(auth, request, { action: 'delivery.create', entityType: 'delivery_order', entityId: (result.data as { id: string }).id })
    return result
  }, { body: deliveryCreateBody })
  .post('/deliveries/:id/assign', async ({ params, body, auth, request, merchantContext }) => {
    const result = await DeliveryOrdersService.assign(auth.db, auth.merchant.id, params.id, body.driverId, merchantContext)
    await auditFromRequest(auth, request, { action: 'delivery.assign', entityType: 'delivery_order', entityId: params.id, metadata: { driverId: body.driverId } })
    return result
  }, { params: deliveryParams, body: deliveryAssignBody })
  .post('/deliveries/:id/dispatch', async ({ params, auth, request, merchantContext }) => {
    const result = await DeliveryOrdersService.autoDispatch(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'delivery.dispatch', entityType: 'delivery_order', entityId: params.id })
    return result
  }, { params: deliveryParams })
  .post('/deliveries/:id/unassign', async ({ params, auth, request, merchantContext }) => {
    const result = await DeliveryOrdersService.unassign(auth.db, auth.merchant.id, params.id, merchantContext)
    await auditFromRequest(auth, request, { action: 'delivery.unassign', entityType: 'delivery_order', entityId: params.id })
    return result
  }, { params: deliveryParams })
  .post('/deliveries/:id/status', async ({ params, body, auth, request, merchantContext }) => {
    const result = await DeliveryOrdersService.transition(auth.db, auth.merchant.id, params.id, body.status, merchantContext)
    await auditFromRequest(auth, request, { action: 'delivery.status', entityType: 'delivery_order', entityId: params.id, metadata: { status: body.status } })
    return result
  }, { params: deliveryParams, body: deliveryTransitionBody })

/* Driver self-service: OWN scope via delivery.read (driver role). */
export const driverSelfModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(outletGuard({ module: 'delivery', permissions: ['delivery.read'] }))
  .get('/delivery/me', async ({ auth }) => DriversService.getByUserId(auth.db, auth.merchant.id, auth.user.id), {
    detail: { summary: 'My driver profile' }
  })
  .put('/delivery/me', async ({ body, auth, request }) => {
    const driver = await DriversService.getByUserId(auth.db, auth.merchant.id, auth.user.id)
    const result = await DriversService.setStatus(auth.db, auth.merchant.id, (driver.data as { id: string }).id, body.status ?? 'ONLINE')
    await auditFromRequest(auth, request, { action: 'driver.me.status', entityType: 'driver', entityId: (driver.data as { id: string }).id, metadata: { status: body.status } })
    return result
  }, { body: driverMeBody })
  .post('/delivery/me/location', async ({ body, auth }) => DriversService.updateLocation(auth.db, auth.merchant.id, auth.user.id, { lat: body.lat!, lng: body.lng! }), {
    body: driverMeBody,
    detail: { summary: 'Report driver location' }
  })
  .get('/delivery/me/orders', async ({ auth }) => DeliveryOrdersService.listForDriver(auth.db, auth.merchant.id, auth.user.id), {
    detail: { summary: 'My assigned deliveries' }
  })
