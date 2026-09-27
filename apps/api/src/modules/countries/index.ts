import { Elysia, t } from 'elysia'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { notFound } from '../../shared/errors'
import { ok } from '../../shared/response'

/**
 * Reference geography dataset (embedded ISO 3166-1 + curated subdivisions).
 * Public — storefront checkout and settings selects consume it without auth.
 * Countries without a curated subdivision list return [] (callers fall back
 * to free text); extend coverage by adding entries to data/geo/states.json.
 */

const dir = path.dirname(fileURLToPath(import.meta.url))
const geoDir = path.resolve(dir, '../../data/geo')

type CountryRow = [code: string, name: string]
type StateRow = [code: string, name: string]

let countriesCache: CountryRow[] | null = null
const statesCache = new Map<string, StateRow[]>()

function loadCountries(): CountryRow[] {
  if (!countriesCache) {
    const raw = JSON.parse(readFileSync(path.join(geoDir, 'countries.json'), 'utf-8')) as {
      countries: CountryRow[]
    }
    countriesCache = raw.countries
  }
  return countriesCache
}

function loadStates(code: string): StateRow[] | null {
  const upper = code.toUpperCase()
  if (statesCache.has(upper)) return statesCache.get(upper)!
  const raw = JSON.parse(readFileSync(path.join(geoDir, 'states.json'), 'utf-8')) as Record<string, StateRow[]>
  for (const [k, v] of Object.entries(raw)) statesCache.set(k.toUpperCase(), v)
  return statesCache.get(upper) ?? null
}

/** Localized country name via runtime ICU; English fallback. */
function localizeCountry(code: string, nameEn: string, locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale, 'en'], { type: 'region' })
    return display.of(code) ?? nameEn
  } catch {
    return nameEn
  }
}

export const countriesModule = new Elysia({ prefix: '/api' })
  .get(
    '/countries',
    ({ query }) => {
      const locale = query.locale === 'ar' ? 'ar' : 'en'
      const items = loadCountries().map(([code, nameEn]) => ({
        code,
        name: locale === 'ar' ? localizeCountry(code, nameEn, 'ar') : nameEn
      }))
      return ok({ items })
    },
    { query: t.Object({ locale: t.Optional(t.String()) }) }
  )
  .get(
    '/countries/:code/states',
    ({ params, query }) => {
      const code = params.code.toUpperCase()
      const known = loadCountries().some(([c]) => c === code)
      if (!known) throw notFound('COUNTRY_NOT_FOUND', `Unknown country code: ${params.code}`)
      const states = loadStates(code) ?? []
      const locale = query.locale === 'ar' ? 'ar' : 'en'
      return ok({
        country: code,
        hasStates: states.length > 0,
        items: states.map(([stateCode, nameEn]) => ({
          code: stateCode,
          name: locale === 'ar' ? nameEn : nameEn
        }))
      })
    },
    {
      params: t.Object({ code: t.String({ minLength: 2, maxLength: 2 }) }),
      query: t.Object({ locale: t.Optional(t.String()) })
    }
  )

export function __clearGeoCache() {
  countriesCache = null
  statesCache.clear()
}
