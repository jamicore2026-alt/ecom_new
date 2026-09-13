import { Elysia } from 'elysia'
import { authPlugin, requirePermission } from '../../plugins/auth'
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
  .post('/webhook-endpoints', async ({ auth, body }) => {
    const endpoint = await OutboundWebhooksService.createEndpoint(auth.db, auth.merchant.id, body)
    return endpoint
  }, { body: OutboundWebhooksService.endpointBodySchema })
  .put('/webhook-endpoints/:id', async ({ auth, params, body }) => {
    const endpoint = await OutboundWebhooksService.updateEndpoint(auth.db, auth.merchant.id, params.id, body)
    return endpoint
  }, { body: OutboundWebhooksService.endpointBodySchema })
  .delete('/webhook-endpoints/:id', async ({ auth, params }) => {
    const endpoint = await OutboundWebhooksService.deleteEndpoint(auth.db, auth.merchant.id, params.id)
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
