import { Elysia } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { merchants, paymentProviderConfigs, webhookEvents } from '../../database/schema'
import { getProvider } from '../../payments/registry'
import { decryptJson } from '../../shared/crypto'
import { badRequest, notFound } from '../../shared/errors'
import { ok } from '../../shared/response'
import { OrdersService } from '../orders/service'

export const webhooksModule = new Elysia({ prefix: '/api', name: 'webhooks' }).post(
  '/webhooks/:provider/:slug',
  async ({ params, query, body, headers }) => {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.slug, params.slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')

    const adapter = getProvider(params.provider)
    if (!adapter) throw notFound('NOT_FOUND', `Unknown provider: ${params.provider}`)

    const [configRow] = await db
      .select()
      .from(paymentProviderConfigs)
      .where(
        and(
          eq(paymentProviderConfigs.merchantId, merchant.id),
          eq(paymentProviderConfigs.provider, params.provider)
        )
      )
    if (!configRow) {
      throw badRequest('PROVIDER_NOT_CONFIGURED', `${adapter.def.label} is not configured`)
    }

    const config = {
      providerId: params.provider,
      enabled: configRow.enabled,
      mode: (configRow.mode === 'live' ? 'live' : 'test') as 'test' | 'live',
      country: configRow.country ?? null,
      credentials: decryptJson<Record<string, string>>(configRow.credentials)
    }

    const result = await adapter.verifyCallback(config, {
      query,
      body,
      headers
    })

    // Idempotency — the same provider event must only be applied once.
    const inserted = await db
      .insert(webhookEvents)
      .values({
        provider: params.provider,
        eventId: result.eventId.slice(0, 255),
        payload: body as object | null
      })
      .onConflictDoNothing({
        target: [webhookEvents.provider, webhookEvents.eventId]
      })
      .returning({ id: webhookEvents.id })

    if (inserted.length === 0) {
      return ok({ received: true, duplicate: true })
    }

    try {
      await OrdersService.applyPaymentResult(merchant.id, params.provider, result)
    } catch (err) {
      // Release the claim so the provider's retry can be applied — a failed
      // application must not be swallowed by dedupe forever.
      await db.delete(webhookEvents).where(eq(webhookEvents.id, inserted[0].id))
      throw err
    }

    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.id, inserted[0].id))

    return ok({ received: true })
  }
)
