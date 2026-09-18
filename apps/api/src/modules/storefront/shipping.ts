import { badRequest } from '../../shared/errors'
import { DEFAULT_CHECKOUT_REQUIRED_FIELDS } from '../../shared/types'
import type { CheckoutFieldRequirements, ShippingRule } from '../../shared/types'

/** A delivery location at the granularity the rules engine understands. */
export interface DeliveryLocation {
  country?: string
  state?: string
  city?: string
  postalCode?: string
}

export interface ShippingContext {
  zones: Array<{ name: string; countries: string[]; rate: number; freeAbove?: number }>
  rules?: ShippingRule[]
  freeAt: number
}

/**
 * Resolve the delivery rate for a subtotal + location.
 *
 * Priority (PDF-correction): PIN (exact or leading-prefix "*") → city → state →
 * country → default. When the merchant configured hierarchical rules, those
 * govern; otherwise we fall back to the legacy country zones. A configured rule
 * set that matches nothing still falls back to zones so a partially populated
 * rule list can never silently block every order. Returns 0/flat when the store
 * has neither rules nor zones.
 */
export function computeShippingRate(
  ctx: ShippingContext,
  subtotal: number,
  location?: DeliveryLocation
): { method: string; rate: number } {
  const freeAt = ctx.freeAt ?? 0
  if (freeAt > 0 && subtotal >= freeAt) return { method: 'Free shipping', rate: 0 }

  const norm = (v?: string) => v?.trim().toLowerCase() ?? ''
  const country = norm(location?.country)
  const state = norm(location?.state)
  const city = norm(location?.city)
  const postalCode = (location?.postalCode ?? '').trim()

  const rules = (ctx.rules ?? []).filter((r) => r.enabled)
  if (rules.length > 0) {
    const matchesPin = (rule: ShippingRule) => {
      if (rule.type !== 'pin' || !rule.postalCode) return false
      if (rule.country && norm(rule.country) !== country) return false
      const want = rule.postalCode.trim()
      if (want.endsWith('*')) return postalCode.startsWith(want.slice(0, -1))
      return want.toLowerCase() === postalCode.toLowerCase()
    }
    const matchesArea = (rule: ShippingRule) => {
      if (rule.country && norm(rule.country) !== country) return false
      if (rule.type === 'city') return city !== '' && norm(rule.city) === city
      if (rule.type === 'state') return state !== '' && norm(rule.state) === state
      if (rule.type === 'country') return country !== '' && norm(rule.country) === country
      return false
    }
    const rule =
      rules.find(matchesPin) ??
      rules.find((r) => r.type === 'city' && matchesArea(r)) ??
      rules.find((r) => r.type === 'state' && matchesArea(r)) ??
      rules.find((r) => r.type === 'country' && matchesArea(r)) ??
      rules.find((r) => r.type === 'default') ??
      null
    if (rule) {
      if (rule.freeAbove && subtotal >= rule.freeAbove) return { method: rule.name, rate: 0 }
      return { method: rule.name, rate: Number(rule.rate) }
    }
  }

  const zones = ctx.zones
  if (!zones.length) return { method: 'Flat rate', rate: 0 }
  const zone =
    zones.find(
      (z) => !z.countries?.length || (country && z.countries.some((c) => norm(c) === country))
    ) ?? null
  if (!zone) {
    const countryLabel = (location?.country ?? '').trim() || 'this country'
    throw badRequest('UNSUPPORTED_COUNTRY', `We don't ship to ${countryLabel}`)
  }
  if (zone.freeAbove && subtotal >= zone.freeAbove) return { method: zone.name, rate: 0 }
  return { method: zone.name, rate: Number(zone.rate) }
}

/**
 * Delivery-country restriction: when a merchant sets their home country — and
 * no shipping zone enumerates explicit countries — the storefront may only
 * deliver to that country (KW merchant → Kuwait only). Explicit zone country
 * lists still win, with the merchant's country always accepted. No merchant
 * country + no explicit zone list = unrestricted (backward compatible).
 */
export function assertShippingSupported(
  ctx: Pick<ShippingContext, 'zones'> & { merchantCountry?: string | null },
  country?: string
) {
  const zones = ctx.zones
  const zonedCountries = zones.flatMap((z) => (z.countries ?? []) as string[])
  if (zonedCountries.length > 0) return
  const home = ctx.merchantCountry
  if (!home) return
  if (country && country.trim().toUpperCase() === home.trim().toUpperCase()) return
  throw badRequest(
    'UNSUPPORTED_COUNTRY',
    `We only deliver ${home ? 'to ' + home : 'within your area'}`
  )
}

const REQUIRED_FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  name: 'Full name',
  line1: 'Address',
  line2: 'Apartment / suite',
  city: 'City',
  state: 'State',
  postalCode: 'PIN code',
  country: 'Country'
}

/**
 * Enforce the merchant's configurable checkout field requirements against a
 * shipping address. Email is optional by default; everything else defaults to
 * required (PDF-correction). Only fields the address actually fails are
 * reported — the first missing field raises MISSING_FIELD.
 */
export function validateRequiredFields(
  requiredFields: CheckoutFieldRequirements | undefined,
  address?: Record<string, unknown>
) {
  const requirements = requiredFields ?? DEFAULT_CHECKOUT_REQUIRED_FIELDS
  const present = (field: string) => {
    const v = address?.[field]
    return typeof v === 'string' ? v.trim().length > 0 : v != null
  }
  for (const field of Object.keys(requirements)) {
    if (requirements[field as keyof CheckoutFieldRequirements] && !present(field)) {
      throw badRequest(
        'MISSING_FIELD',
        `${REQUIRED_FIELD_LABELS[field] ?? field} is required`
      )
    }
  }
}