import { describe, expect, it } from 'bun:test'
import { app } from '../src/app'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

describe('Countries reference dataset (no auth)', () => {
  it('lists ISO countries in English by default', async () => {
    const res = await call('/api/countries')
    expect(res.status).toBe(200)
    expect(res.body.data.items.length).toBeGreaterThan(200)
    const kw = res.body.data.items.find((c: any) => c.code === 'KW')
    expect(kw.name).toBe('Kuwait')
  })

  it('localizes country names to Arabic', async () => {
    const res = await call('/api/countries?locale=ar')
    expect(res.status).toBe(200)
    const kw = res.body.data.items.find((c: any) => c.code === 'KW')
    expect(kw.name).toBe('الكويت')
  })

  it('returns states for a covered country', async () => {
    const res = await call('/api/countries/KW/states')
    expect(res.status).toBe(200)
    expect(res.body.data.country).toBe('KW')
    expect(res.body.data.hasStates).toBe(true)
    expect(res.body.data.items.map((s: any) => s.code)).toContain('HA')
  })

  it('returns an empty list for countries without curated states', async () => {
    const res = await call('/api/countries/NO/states')
    expect(res.status).toBe(200)
    expect(res.body.data.hasStates).toBe(false)
    expect(res.body.data.items).toEqual([])
  })

  it('404s unknown country codes', async () => {
    const res = await call('/api/countries/XX/states')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('COUNTRY_NOT_FOUND')
  })
})
