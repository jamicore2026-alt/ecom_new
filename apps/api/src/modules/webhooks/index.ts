import { Elysia } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { withTenantContext } from '../../database/tenant-context'
import { merchants, paymentProviderConfigs, webhookEvents } from '../../database/schema'
import { getProvider } from '../../payments/registry'
import { decryptJson } from '../../shared/crypto'
import { badRequest, notFound } from '../../shared/errors'
import { ok } from '../../shared/response'
import { OrdersService } from '../orders/service'

export const webhooksModule = new Elysia({ prefix: '/api', name: 'webhooks' })
  // Capture the raw body BEFORE parsing so adapters can verify raw-body HMAC
  // signatures. Elysia consumes the request stream during its own parse phase,
  // so without this hook the exact bytes are unrecoverable downstream.
  .onParse(async ({ request }) => {
    const text = await request.text()
    ;(request as unknown as { rawBody?: string }).rawBody = text
    if (!text) return null
    const ct = request.headers.get('content-type') ?? ''
    if (!ct.includes('form') && !ct.includes('multipart')) {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    if (ct.includes('x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(text))
    }
    return text
  })
  .post(
  '/webhooks/:provider/:slug',
  async ({ params, query, body, headers, request }) => {
    // Pre-merchant lookup stays on the admin connection: no tenant is known
    // yet, so no tenant context can be opened here.
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.slug, params.slug), eq(merchants.status, 'active')))
    if (!merchant) throw notFound('STORE_NOT_FOUND', 'Store not found')

    const adapter = getProvider(params.provider)
    if (!adapter) throw notFound('NOT_FOUND', `Unknown provider: ${params.provider}`)

    // The merchant is identified by the payload/signature, not a JWT, so all
    // DB work below runs under a tenant context opened for that merchant.
    return withTenantContext(merchant.id, async (tenantDb) => {
      const [configRow] = await tenantDb
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
        headers,
        rawBody: (request as unknown as { rawBody?: string }).rawBody
      })

      // Idempotency — the same provider event must only be applied once.
      const inserted = await tenantDb
        .insert(webhookEvents)
        .values({
          merchantId: merchant.id,
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
        await OrdersService.applyPaymentResult(tenantDb, merchant.id, params.provider, result)
      } catch (err) {
        // Release the claim so the provider's retry can be applied — a failed
        // application must not be swallowed by dedupe forever.
        await tenantDb.delete(webhookEvents).where(eq(webhookEvents.id, inserted[0].id))
        throw err
      }

      await tenantDb
        .update(webhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(webhookEvents.id, inserted[0].id))

      return ok({ received: true })
    })
  }
)
