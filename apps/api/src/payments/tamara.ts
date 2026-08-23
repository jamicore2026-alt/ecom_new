import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { badRequest } from '../shared/errors'
import type {
  CallbackResult,
  CallbackVerifyInput,
  PaymentProviderAdapter,
  PaymentProviderDef,
  ProviderSession,
  RefundInput,
  RefundResult,
  ResolvedProviderConfig,
  SessionOrderContext
} from './types'

const baseUrl = (config: ResolvedProviderConfig) =>
  config.mode === 'test' ? 'https://api-sandbox.tamara.co' : 'https://api.tamara.co'

export const tamaraDef: PaymentProviderDef = {
  id: 'tamara',
  label: 'Tamara — Pay in 4',
  description:
    'GCC BNPL (buy now pay later) — pay in 4 interest-free installments. KSA, UAE, Kuwait, Qatar, Bahrain.',
  countries: ['SA', 'AE', 'KW', 'QA', 'BH'],
  currencies: ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'USD'],
  credentialFields: [
    { key: 'publicKey', label: 'Public key', secret: false, required: true },
    { key: 'apiToken', label: 'API token (secret)', secret: true, required: true },
    {
      key: 'notificationToken',
      label: 'Webhook notification token',
      secret: true,
      required: false
    }
  ]
}

const headers = (config: ResolvedProviderConfig) => ({
  Authorization: `Bearer ${config.credentials.apiToken ?? ''}`,
  'public-key': config.credentials.publicKey ?? '',
  nonce: randomUUID(),
  'Content-Type': 'application/json'
})

async function request<T>(
  config: ResolvedProviderConfig,
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown
): Promise<{ status: number; data: T }> {
  if (!config.credentials.apiToken || !config.credentials.publicKey) {
    throw badRequest('PROVIDER_NOT_CONFIGURED', 'Tamara credentials are not configured')
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl(config)}${path}`, {
      method,
      headers: headers(config),
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  } catch {
    throw badRequest('PROVIDER_UNREACHABLE', 'Could not reach Tamara')
  }
  const data = await res.json().catch(() => null)
  return { status: res.status, data: data as T }
}

/** Verifies the JWT `tamaraToken` sent with Tamara webhooks (HS256, signed with notification token). */
export const verifyTamaraJwt = (
  token: string | undefined,
  secret: string | undefined
): boolean => {
  if (!token) return false
  if (!secret) return false // no shared secret configured → cannot authenticate webhook

  const parts = token.split('.')
  if (parts.length !== 3) return false

  let header: { alg?: string; typ?: string }
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if ((header.alg ?? '') !== 'HS256') return false

  const expected = createHmac('sha256', secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest()
  const received = Buffer.from(parts[2], 'base64url')
  if (received.length !== expected.length) return false
  if (!timingSafeEqual(received, expected)) return false

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    const exp = payload?.exp
    if (typeof exp === 'number' && exp * 1000 < Date.now()) return false
  } catch {
    return false
  }
  return true
}

interface TamaraOrder {
  order_id: string
  status: string
  order_reference_id?: string
}

const mapStatus = (status: string): CallbackResult['status'] => {
  switch (status) {
    case 'approved':
    case 'authorised':
    case 'fully_captured':
    case 'partially_captured':
      return 'paid'
    case 'declined':
    case 'cancelled':
    case 'canceled':
    case 'expired':
      return 'failed'
    default:
      return 'pending'
  }
}

export const tamaraAdapter: PaymentProviderAdapter = {
  def: tamaraDef,

  async createSession(config, ctx: SessionOrderContext): Promise<ProviderSession> {
    const currency = ctx.currency
    const name = (ctx.customer.name ?? '').trim()
    const [firstName, ...rest] = name.split(' ')
    const refId = ctx.orderNumber.replace(/[^a-zA-Z0-9_-]/g, '')

    const body = {
      total_amount: { amount: ctx.total, currency },
      shipping_amount: { amount: 0, currency },
      tax_amount: { amount: 0, currency },
      order_reference_id: refId,
      order_number: refId,
      items: ctx.items.map((i, idx) => ({
        reference_id: `${refId}-${idx + 1}`,
        type: 'physical',
        name: i.name,
        sku: `${refId}-${idx + 1}`,
        quantity: i.quantity,
        unit_price: { amount: i.unitPrice, currency },
        total_amount: { amount: i.unitPrice * i.quantity, currency }
      })),
      consumer: {
        first_name: firstName || 'Customer',
        last_name: rest.join(' ') || firstName || 'Customer',
        email: ctx.customer.email ?? 'customer@example.com',
        phone: ctx.customer.phone ?? ''
      },
      country_code: config.country ?? 'SA',
      locale: 'en-US',
      payment_type: 'PAY_BY_INSTALMENTS',
      shipping_address: ctx.shippingAddress as Record<string, unknown> | undefined,
      return_url: ctx.returnUrl,
      cancel_url: ctx.cancelUrl,
      notification_url: ctx.webhookUrl,
      is_mobile_payment: false
    }

    const { status, data } = await request<{
      checkout_url?: string
      order_id?: string
      checkout_id?: string
      status?: string
      message?: string
    }>(config, '/checkout', 'POST', body)

    if (status === 401) {
      throw badRequest('PROVIDER_AUTH_FAILED', 'Tamara rejected the API token')
    }
    if (!data?.checkout_url || !data?.order_id) {
      throw badRequest(
        'PROVIDER_ERROR',
        `Tamara: ${data?.message ?? 'checkout session creation failed'}`
      )
    }

    return { providerRef: data.order_id, redirectUrl: data.checkout_url, raw: data }
  },

  async verifyCallback(config, input: CallbackVerifyInput): Promise<CallbackResult> {
    // Authenticate the webhook via its signed tamaraToken when configured…
    const token =
      input.headers.authorization ??
      input.headers['tamara-token'] ??
      ((input.body as Record<string, unknown> | null)?.token as string | undefined)
    verifyTamaraJwt(token, config.credentials.notificationToken)

    // …then confirm against Tamara's own record — never trust the payload alone.
    const body = input.body as Record<string, unknown> | null
    const orderId =
      (body?.order_id as string | undefined) ?? input.query.orderId ?? undefined
    if (!orderId) {
      throw badRequest('PROVIDER_CALLBACK_INVALID', 'Missing order_id in callback')
    }

    const { status, data } = await request<TamaraOrder & { message?: string }>(
      config,
      `/orders/${orderId}`,
      'GET'
    )

    if (status === 401 || !data?.order_id) {
      throw badRequest(
        'PROVIDER_ERROR',
        `Tamara order lookup failed${data && typeof data.message === 'string' ? `: ${data.message}` : ''}`
      )
    }

    return {
      providerRef: data.order_id,
      status: mapStatus(data.status),
      eventId: `${data.order_id}:${data.status}`,
      raw: data
    }
  },

  async ping(config: ResolvedProviderConfig): Promise<void> {
    const { status } = await request(
      config,
      '/orders/00000000-0000-0000-0000-000000000000',
      'GET'
    )
    if (status === 401) throw badRequest('PROVIDER_AUTH_FAILED', 'Tamara rejected the API token')
    if (status >= 500) throw badRequest('PROVIDER_UNREACHABLE', 'Tamara is unavailable')
  },

  async refund(config, input: RefundInput): Promise<RefundResult> {
    const { status, data } = await request<Record<string, unknown>>(
      config,
      `/payments/simplified-refund/${input.providerRef}`,
      'POST',
      {
        total_amount: { amount: input.amount, currency: input.currency },
        comment: input.comment ?? 'Order refund'
      }
    )

    if (status === 401) {
      throw badRequest('REFUND_FAILED', 'Tamara rejected the API token')
    }
    if (status >= 400) {
      throw badRequest(
        'REFUND_FAILED',
        `Tamara refund failed${data && typeof data.message === 'string' ? `: ${data.message}` : ''}`
      )
    }
    return { ref: input.providerRef, status: 'completed', raw: data }
  }
}
