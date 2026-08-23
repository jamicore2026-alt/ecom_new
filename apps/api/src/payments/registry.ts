import type { PaymentProviderAdapter, PaymentProviderDef } from './types'
import { myfatoorahAdapter } from './myfatoorah'
import { tamaraAdapter } from './tamara'

const adapters: Record<string, PaymentProviderAdapter> = {
  myfatoorah: myfatoorahAdapter,
  tamara: tamaraAdapter
}

export const getProvider = (id: string): PaymentProviderAdapter | null => adapters[id] ?? null

export const listProviders = (): PaymentProviderDef[] =>
  Object.values(adapters).map((a) => a.def)
