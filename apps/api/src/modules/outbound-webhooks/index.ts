import { Elysia } from 'elysia'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { backgroundJobs, webhookDeliveries, webhookEndpoints } from '../../database/schema'
import { authPlugin } from '../../plugins/auth'
import { ok } from '../../shared/response'
import { OutboundWebhooksService } from './service'

export const outboundWebhooksModule = new Elysia({ prefix: '/api' })
  .use(authPlugin)

  .get('/webhook-endpoints', async ({ auth }) => {
    const endpoints = await OutboundWebhooksService.listEndpoints(auth.merchant.id)
    return ok({ data: endpoints })
  })
  .get('/webhook-endpoints/:id', async ({ auth, params }) => {
    const endpoint = await OutboundWebhooksService.getEndpoint(auth.merchant.id, params.id)
    return ok({ data: endpoint })
  })
  .post('/webhook-endpoints', async ({ auth, body }) => {
    const endpoint = await OutboundWebhooksService.createEndpoint(auth.merchant.id, body)
    return ok({ data: endpoint })
  }, { body: OutboundWebhooksService.endpointBodySchema })
  .put('/webhook-endpoints/:id', async ({ auth, params, body }) => {
    const endpoint = await OutboundWebhooksService.updateEndpoint(auth.merchant.id, params.id, body)
    return ok({ data: endpoint })
  }, { body: OutboundWebhooksService.endpointBodySchema })
  .delete('/webhook-endpoints/:id', async ({ auth, params }) => {
    const endpoint = await OutboundWebhooksService.deleteEndpoint(auth.merchant.id, params.id)
    return ok({ data: endpoint })
  })

  .get('/webhook-deliveries', async ({ auth, query }) => {
    const deliveries = await OutboundWebhooksService.listDeliveries(auth.merchant.id, query)
    return ok({ data: deliveries })
  })
  .get('/webhook-deliveries/:id', async ({ auth, params }) => {
    const delivery = await OutboundWebhooksService.getDelivery(auth.merchant.id, params.id)
    return ok({ data: delivery })
  })
  .post('/webhook-deliveries/:id/retry', async ({ auth, params }) => {
    const delivery = await OutboundWebhooksService.retryDelivery(auth.merchant.id, params.id)
    return ok({ data: delivery })
  })

  .get('/background-jobs', async ({ auth }) => {
    const jobs = await OutboundWebhooksService.listJobs(auth.merchant.id)
    return ok({ data: jobs })
  })
  .get('/background-jobs/:id', async ({ auth, params }) => {
    const job = await OutboundWebhooksService.getJob(auth.merchant.id, params.id)
    return ok({ data: job })
  })
