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

const LIVE_HOSTS: Record<string, string> = {
  SA: 'https://api-sa.myfatoorah.com',
  AE: 'https://api-ae.myfatoorah.com',
  QA: 'https://api-qa.myfatoorah.com',
  EG: 'https://api-eg.myfatoorah.com'
}

const DEFAULT_LIVE_HOST = 'https://api.myfatoorah.com'
const TEST_HOST = 'https://apitest.myfatoorah.com'

export const myfatoorahDef: PaymentProviderDef = {
  id: 'myfatoorah',
  label: 'MyFatoorah',
  description:
    'GCC payment gateway — KNET (KW), Mada (SA), BENEFIT (BH), Apple Pay, Visa/Mastercard. Hosted checkout.',
  countries: ['KW', 'SA', 'AE', 'BH', 'QA', 'OM'],
  currencies: ['KWD', 'SAR', 'AED', 'BHD', 'QAR', 'OMR', 'USD', 'EGP', 'JOD'],
  credentialFields: [{ key: 'apiKey', label: 'API secret key', secret: true, required: true }]
}

const baseUrl = (config: ResolvedProviderConfig) =>
  config.mode === 'test' ? TEST_HOST : (LIVE_HOSTS[config.country ?? ''] ?? DEFAULT_LIVE_HOST)

const REQUEST_TIMEOUT_MS = 15_000

async function request<T>(
  config: ResolvedProviderConfig,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const apiKey = config.credentials.apiKey
  if (!apiKey) throw badRequest('PROVIDER_NOT_CONFIGURED', 'MyFatoorah API key is not configured')

  let res: Response
  try {
    res = await fetch(`${baseUrl(config)}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  } catch {
    throw badRequest('PROVIDER_UNREACHABLE', 'Could not reach MyFatoorah')
  }
  const data = await res.json().catch(() => null)
  return { status: res.status, data: data as T }
}

interface MFResponse<T> {
  IsSuccess: boolean
  Message?: string
  ValidationErrors?: Array<{ Name: string; Error: string }>
  Data: T
}

export const myfatoorahAdapter: PaymentProviderAdapter = {
  def: myfatoorahDef,

  async createSession(config, ctx: SessionOrderContext): Promise<ProviderSession> {
    const { status, data } = await request<MFResponse<{ InvoiceURL: string; InvoiceId: number }>>(
      config,
      '/v2/SendPayment',
      {
        InvoiceValue: ctx.total,
        DisplayCurrencyIso: ctx.currency,
        CustomerName: ctx.customer.name || ctx.customer.email || 'Customer',
        CustomerEmail: ctx.customer.email,
        MobileCountryCode: undefined,
        CustomerMobile: ctx.customer.phone?.replace(/^\+?\d{1,4}/, '') || undefined,
        Language: 'en',
        NotificationOption: 'LNK',
        CustomerReference: ctx.orderNumber,
        UserDefinedField: ctx.orderId,
        CallBackUrl: ctx.returnUrl,
        ErrorUrl: ctx.cancelUrl
      }
    )

    if (status === 401) {
      throw badRequest('PROVIDER_AUTH_FAILED', 'MyFatoorah rejected the API key')
    }
    if (!data?.IsSuccess || !data.Data?.InvoiceURL) {
      throw badRequest(
        'PROVIDER_ERROR',
        `MyFatoorah: ${data?.ValidationErrors?.[0]?.Error ?? data?.Message ?? 'session creation failed'}`
      )
    }

    return { providerRef: String(data.Data.InvoiceId), redirectUrl: data.Data.InvoiceURL, raw: data }
  },

  async verifyCallback(config, input: CallbackVerifyInput): Promise<CallbackResult> {
    // Never trust the redirect payload — re-fetch authoritative status server-side.
    // providerRef is the server-resolved reference from our own transaction row.
    const paymentId =
      input.providerRef ??
      input.query.paymentId ??
      (input.body as Record<string, unknown> | null)?.paymentId ??
      ((input.body as Record<string, unknown> | null)?.Data as Record<string, unknown> | undefined)
        ?.PaymentId

    if (!paymentId || typeof paymentId !== 'string') {
      throw badRequest('PROVIDER_CALLBACK_INVALID', 'Missing paymentId in callback')
    }

    const { status, data } = await request<
      MFResponse<{
        InvoiceId: number
        InvoiceStatus: string
        InvoiceReference: string
        InvoiceValue?: number
        InvoiceDisplayCurrency?: string
        InvoiceTransactions: Array<{ TransactionStatus: string; PaidAmount?: number }>
      }>
    >(config, '/v2/GetPaymentStatus', { Key: paymentId, KeyType: 'PaymentId' })

    if (status === 401) {
      throw badRequest('PROVIDER_AUTH_FAILED', 'MyFatoorah rejected the API key')
    }
    if (status >= 500) {
      throw badRequest('PROVIDER_UNREACHABLE', 'MyFatoorah is unavailable')
    }
    if (!data?.IsSuccess) {
      throw badRequest(
        'PROVIDER_ERROR',
        `MyFatoorah status check failed: ${data?.Message ?? 'unauthorized'}`
      )
    }

    const invoiceStatus = data.Data.InvoiceStatus
    const map: Record<string, CallbackResult['status']> = {
      Paid: 'paid',
      Pending: 'pending',
      Canceled: 'failed',
      Cancelled: 'failed',
      Expired: 'failed',
      Failed: 'failed'
    }

    // Captured amount = sum of successful transaction payments on the invoice.
    const paidAmount = (data.Data.InvoiceTransactions ?? [])
      .filter((t) => ['Success', 'Succss'].includes(t.TransactionStatus))
      .reduce((sum, t) => sum + Number(t.PaidAmount ?? 0), 0)

    return {
      providerRef: String(data.Data.InvoiceId),
      status: map[invoiceStatus] ?? 'failed',
      eventId: `${data.Data.InvoiceId}:${invoiceStatus}`,
      amount: paidAmount > 0 ? paidAmount : data.Data.InvoiceValue,
      currency: data.Data.InvoiceDisplayCurrency,
      raw: data
    }
  },

  async ping(config: ResolvedProviderConfig): Promise<void> {
    const { status } = await request(config, '/v2/GetPaymentStatus', {
      Key: '0',
      KeyType: 'InvoiceId'
    })
    if (status === 401) throw badRequest('PROVIDER_AUTH_FAILED', 'MyFatoorah rejected the API key')
    if (status >= 500) throw badRequest('PROVIDER_UNREACHABLE', 'MyFatoorah is unavailable')
  },

  async refund(config, input: RefundInput): Promise<RefundResult> {
    const { status, data } = await request<
      MFResponse<{ RefundId: number; RefundReference: string }>
    >(config, '/v2/MakeRefund', {
      KeyType: 'InvoiceId',
      Key: input.providerRef,
      RefundChargeOnCustomer: false,
      ServiceChargeOnCustomer: false,
      Amount: input.amount,
      Comment: input.comment ?? 'Order refund'
    })

    if (status === 401 || !data?.IsSuccess) {
      throw badRequest(
        'REFUND_FAILED',
        `MyFatoorah refund failed: ${data?.Message ?? 'unauthorized'}`
      )
    }
    return { ref: String(data.Data.RefundId), status: 'completed', raw: data }
  }
}
