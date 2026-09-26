import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
import { auditFromRequest } from '../audit-logs'
import { OutboundWebhooksService } from './service'

export const outboundWebhooksModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)
  .use(requirePermission('settings.manage'))

  .get('/webhook-endpoints', async ({ auth }) => {
    const endpoints = await OutboundWebhooksService.listEndpoints(auth.db, auth.merchant.id)
    return endpoints
  })
  .get('/webhook-endpoints/:id', async ({ auth, params }) => {
    const endpoint = await OutboundWebhooksService.getEndpoint(auth.db, auth.merchant.id, params.id)
    return endpoint
  })
  .post('/webhook-endpoints', async ({ auth, body, request }) => {
    const endpoint = await OutboundWebhooksService.createEndpoint(auth.db, auth.merchant.id, body)
    await auditFromRequest(auth, request, {
      action: 'settings.webhook_endpoint.create',
      entityType: 'webhook_endpoint',
      entityId: (endpoint as { data?: { id?: string } })?.data?.id ?? undefined
    })
    return endpoint
  }, { body: OutboundWebhooksService.endpointBodySchema })
  .put('/webhook-endpoints/:id', async ({ auth, params, body, request }) => {
    const endpoint = await OutboundWebhooksService.updateEndpoint(auth.db, auth.merchant.id, params.id, body)
    await auditFromRequest(auth, request, {
      action: 'settings.webhook_endpoint.update',
      entityType: 'webhook_endpoint',
      entityId: params.id
    })
    return endpoint
  }, { body: OutboundWebhooksService.endpointBodySchema })
  .post('/webhook-endpoints/:id/rotate', async ({ auth, params, body, request }) => {
    const result = await OutboundWebhooksService.rotateSecret(auth.db, auth.merchant.id, params.id, body)
    await auditFromRequest(auth, request, {
      action: 'settings.webhook_endpoint.rotate_secret',
      entityType: 'webhook_endpoint',
      entityId: params.id
    })
    return result
  }, { body: OutboundWebhooksService.rotateSecretBodySchema })
  .delete('/webhook-endpoints/:id', async ({ auth, params, request }) => {
    const endpoint = await OutboundWebhooksService.deleteEndpoint(auth.db, auth.merchant.id, params.id)
    await auditFromRequest(auth, request, {
      action: 'settings.webhook_endpoint.delete',
      entityType: 'webhook_endpoint',
      entityId: params.id
    })
    return endpoint
  })

  .get('/webhook-deliveries', async ({ auth, query }) => {
    const deliveries = await OutboundWebhooksService.listDeliveries(auth.db, auth.merchant.id, query)
    return deliveries
  })
  .get('/webhook-deliveries/:id', async ({ auth, params }) => {
    const delivery = await OutboundWebhooksService.getDelivery(auth.db, auth.merchant.id, params.id)
    return delivery
  })
  .post('/webhook-deliveries/replay-all-dead', async ({ auth }) => {
    const result = await OutboundWebhooksService.replayAllDead(auth.db, auth.merchant.id)
    return result
  })
  .post('/webhook-deliveries/:id/replay', async ({ auth, params }) => {
    const delivery = await OutboundWebhooksService.replayDelivery(auth.db, auth.merchant.id, params.id)
    return delivery
  })
  .post('/webhook-deliveries/:id/retry', async ({ auth, params }) => {
    const delivery = await OutboundWebhooksService.retryDelivery(auth.db, auth.merchant.id, params.id)
    return delivery
  })

  .get('/background-jobs', async ({ auth }) => {
    const jobs = await OutboundWebhooksService.listJobs(auth.db, auth.merchant.id)
    return jobs
  })
  .get('/background-jobs/:id', async ({ auth, params }) => {
    const job = await OutboundWebhooksService.getJob(auth.db, auth.merchant.id, params.id)
    return job
  })
