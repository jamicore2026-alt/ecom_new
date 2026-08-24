export interface ProviderCredentialField {
  key: string
  label: string
  secret: boolean
  required: boolean
}

/** Static, code-level definition of a payment provider (no secrets). */
export interface PaymentProviderDef {
  id: string
  label: string
  description: string
  countries: string[]
  currencies: string[]
  credentialFields: ProviderCredentialField[]
}

/** Merchant-specific runtime config with decrypted credentials. */
export interface ResolvedProviderConfig {
  providerId: string
  enabled: boolean
  mode: 'test' | 'live'
  country?: string | null
  credentials: Record<string, string>
}

export type CallbackStatus = 'paid' | 'failed' | 'pending'

export interface SessionOrderContext {
  orderId: string
  orderNumber: string
  total: number
  currency: string
  customer: { name?: string; email?: string; phone?: string }
  items: Array<{ name: string; quantity: number; unitPrice: number; total?: number }>
  /** Order-level components so providers receive a consistent amount breakdown. */
  shippingAmount?: number
  taxAmount?: number
  shippingAddress?: Record<string, unknown>
  returnUrl: string
  cancelUrl: string
  webhookUrl: string
}

export interface ProviderSession {
  providerRef: string
  redirectUrl: string
  raw?: unknown
}

export interface CallbackVerifyInput {
  query: Record<string, string>
  body: unknown
  headers: Record<string, string | undefined>
  /** Server-resolved provider reference for the order (sync flow) — preferred over client payload. */
  providerRef?: string
}

export interface CallbackResult {
  providerRef: string
  status: CallbackStatus
  eventId: string
  /** Captured amount + currency when the gateway reports them — verified against the txn. */
  amount?: number
  currency?: string
  raw?: unknown
}

export interface RefundInput {
  providerRef: string
  amount: number
  currency: string
  comment?: string
}

export interface RefundResult {
  ref: string
  status: string
  raw?: unknown
}

export interface PaymentProviderAdapter {
  def: PaymentProviderDef
  createSession(config: ResolvedProviderConfig, ctx: SessionOrderContext): Promise<ProviderSession>
  verifyCallback(config: ResolvedProviderConfig, input: CallbackVerifyInput): Promise<CallbackResult>
  refund(config: ResolvedProviderConfig, input: RefundInput): Promise<RefundResult>
  /** Cheap authenticated call used by "Test connection" — throws HttpError on failure. */
  ping(config: ResolvedProviderConfig): Promise<void>
}
