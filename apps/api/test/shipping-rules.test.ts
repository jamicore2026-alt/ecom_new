import { describe, expect, it } from 'bun:test'
import {
  assertShippingSupported,
  computeShippingRate,
  validateRequiredFields
} from '../src/modules/storefront/shipping'
import type { CheckoutFieldRequirements, ShippingRule, ShippingRuleType } from '../src/shared/types'

const rule = (
  r: Partial<ShippingRule> & {
    id: string
    name: string
    type: ShippingRuleType
    rate: number
  }
): ShippingRule => ({ enabled: true, ...r })

const zones = [
  { name: 'Gulf', countries: ['KW'], rate: 6 },
  { name: 'Rest of world', countries: ['US'], rate: 12 }
]

describe('computeShippingRate (hierarchical rules)', () => {
  it('applies free shipping above the threshold before rules', () => {
    const ctx = { zones, freeAt: 50 }
    expect(computeShippingRate(ctx, 60, { country: 'KW' })).toEqual({ method: 'Free shipping', rate: 0 })
  })

  it('matches a default rule when nothing else matches', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [
        rule({ id: '1', name: 'City', type: 'city', city: 'salmiya', rate: 3, enabled: true }),
        rule({ id: '2', name: 'Default', type: 'default', rate: 9, enabled: true })
      ]
    }
    expect(computeShippingRate(ctx, 10, { country: 'KW', city: 'hawally' })).toEqual({ method: 'Default', rate: 9 })
  })

  it('prefers city over default', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [
        rule({ id: '1', name: 'City', type: 'city', city: 'salmiya', rate: 3, enabled: true }),
        rule({ id: '2', name: 'Default', type: 'default', rate: 9, enabled: true })
      ]
    }
    expect(computeShippingRate(ctx, 10, { country: 'KW', city: 'salmiya' })).toEqual({ method: 'City', rate: 3 })
  })

  it('prefers pin over city when the pin matches a prefix wildcard', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [
        rule({ id: '1', name: 'Salmiya block', type: 'pin', postalCode: '1100*', rate: 2 }),
        rule({ id: '2', name: 'Salmiya city', type: 'city', city: 'salmiya', rate: 3 }),
        rule({ id: '3', name: 'Default', type: 'default', rate: 9 })
      ]
    }
    expect(computeShippingRate(ctx, 10, { postalCode: '110050', city: 'salmiya' })).toEqual({
      method: 'Salmiya block',
      rate: 2
    })
    expect(computeShippingRate(ctx, 10, { postalCode: '120100', city: 'salmiya' })).toEqual({
      method: 'Salmiya city',
      rate: 3
    })
  })

  it('requires the rule country to match for area rules', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [rule({ id: '1', name: 'Kuwait', type: 'country', country: 'KW', rate: 4 })]
    }
    expect(computeShippingRate(ctx, 10, { country: 'US' })).toEqual({ method: 'Flat rate', rate: 0 })
  })

  it('ignores disabled rules', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [
        rule({ id: '1', name: 'Off', type: 'default', rate: 1, enabled: false }),
        rule({ id: '2', name: 'On', type: 'default', rate: 5 })
      ]
    }
    expect(computeShippingRate(ctx, 10)).toEqual({ method: 'On', rate: 5 })
  })

it('applies rule freeAbove', () => {
    const ctx = {
      zones: [],
      freeAt: 0,
      rules: [rule({ id: '1', name: 'City', type: 'city', city: 'salmiya', rate: 3, freeAbove: 100 })]
    }
    expect(computeShippingRate(ctx, 120, { city: 'salmiya' })).toEqual({ method: 'City', rate: 0 })
  })

  it('falls back to legacy zones when rules are set up but nothing matches', () => {
    const ctx = { zones, freeAt: 0, rules: [rule({ id: '1', name: 'City', type: 'city', city: 'nowhere', rate: 1 })] }
    expect(computeShippingRate(ctx, 10, { country: 'KW' })).toEqual({ method: 'Gulf', rate: 6 })
  })

  it('rejects an unmatched zone country', () => {
    expect(() => computeShippingRate({ zones, freeAt: 0 }, 10, { country: 'IN' })).toThrowError(
      /don't ship to IN/
    )
  })
})

describe('assertShippingSupported (merchant home-country restriction)', () => {
  it('is unrestricted when the merchant has no country and no explicit zones', () => {
    expect(() =>
      assertShippingSupported({ zones: [], merchantCountry: null }, 'US')
    ).not.toThrow()
  })

  it('blocks non-home countries when merchant country is set', () => {
    try {
      assertShippingSupported({ zones: [], merchantCountry: 'KW' }, 'US')
      expect('should have thrown').toBe('no')
    } catch (e) {
      expect((e as { code?: string }).code).toBe('UNSUPPORTED_COUNTRY')
    }
  })

  it('allows the merchant home country', () => {
    expect(() =>
      assertShippingSupported({ zones: [], merchantCountry: 'KW' }, 'kw')
    ).not.toThrow()
  })

  it('lets explicit zone country lists override the restriction', () => {
    expect(() =>
      assertShippingSupported({ zones, merchantCountry: 'KW' }, 'US')
    ).not.toThrow()
  })
})

describe('validateRequiredFields', () => {
  it('is satisfied by a complete default address', () => {
    expect(() =>
      validateRequiredFields(undefined, {
        name: 'A',
        phone: '+965',
        line1: 'St',
        line2: '2',
        city: 'C',
        state: 'S',
        postalCode: '123',
        country: 'KW'
      })
    ).not.toThrow()
  })

  it('rejects missing required fields (default: email optional)', () => {
    try {
      validateRequiredFields(undefined, { name: 'A' })
      expect('should have thrown').toBe('no')
    } catch (e) {
      expect((e as { code?: string }).code).toBe('MISSING_FIELD')
    }
  })

  it('honours a merchant making email required', () => {
    const reqs: CheckoutFieldRequirements = {
      email: true,
      phone: true,
      name: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true
    }
    try {
      validateRequiredFields(reqs, {
        name: 'A',
        phone: '+965',
        line1: 'St',
        line2: '2',
        city: 'C',
        state: 'S',
        postalCode: '123',
        country: 'KW'
      })
      expect('should have thrown').toBe('no')
    } catch (e) {
      expect((e as { code?: string }).code).toBe('MISSING_FIELD')
      expect((e as { message?: string }).message).toContain('Email')
    }
  })
})