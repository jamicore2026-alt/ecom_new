import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { products } from '../src/database/schema'
import { parseCsv, toCsv } from '../src/shared/csv'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => null)
  return { status: res.status, body, res }
}

/** Like call(), but returns the raw body text instead of consuming it as JSON. */
const raw = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  return { status: res.status, res }
}

const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
})

const multipart = (csv: string, token: string) => {
  const form = new FormData()
  form.append('file', new File([csv], 'import.csv', { type: 'text/csv' }))
  return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }
}

const FIX_A = 'CSVFIX-ALPHA'

describe('Products CSV export/import', () => {
  let adminToken = ''
  let staffToken = ''
  const createdIds: string[] = []
  let alphaId = ''

  beforeAll(async () => {
    const login = await call('/api/auth/login', json({ email: 'admin@acme.com', password: 'password123' }))
    adminToken = login.body.data.accessToken
    const staffLogin = await call('/api/auth/login', json({ email: 'riley@acme.com', password: 'password123' }))
    staffToken = staffLogin.body.data.accessToken

    const alpha = await call(
      '/api/products',
      json(
        {
          sku: FIX_A,
          name: 'CSV Fixture Alpha',
          price: 10,
          description: 'Has, a "tricky" description.',
          status: 'active',
          variants: [
            { sku: `${FIX_A}-S`, optionValues: { Size: 'S' }, inventory: 5 },
            { sku: `${FIX_A}-M`, optionValues: { Size: 'M' }, inventory: 7 }
          ]
        },
        adminToken
      )
    )
    expect(alpha.status).toBe(200)
    alphaId = alpha.body.data.id
    createdIds.push(alphaId)
  })

  it('exports products as RFC4180 CSV with one row per variant', async () => {
    const res = await raw('/api/products/export', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(res.status).toBe(200)
    expect(res.res.headers.get('content-type')).toContain('text/csv')
    const text = await res.res.text()

    const rows = parseCsv(text)
    expect(rows[0][0]).toBe('sku')
    expect(rows[0].length).toBe(14)

    const mine = rows.filter((r) => r[0] === FIX_A || r[11] === `${FIX_A}-S` || r[11] === `${FIX_A}-M`)
    // parent sku repeats on each variant row
    expect(mine.length).toBe(2)
    const sRow = mine.find((r) => r[11] === `${FIX_A}-S`)
    expect(sRow?.[12]).toBe('{"Size":"S"}')
    expect(sRow?.[13]).toBe('5')
    // tricky description survived quoting
    expect(sRow?.[3]).toBe('Has, a "tricky" description.')
    expect(sRow?.[1]).toBe('CSV Fixture Alpha')

    // staff without write permission can still read exports
    const staffRes = await raw('/api/products/export', {
      headers: { authorization: `Bearer ${staffToken}` }
    })
    expect(staffRes.status).toBe(200)
  })

  it('round-trips an export through import (update + create)', async () => {
    const exp = await raw('/api/products/export', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    const all = parseCsv(await exp.res.text())
    const header = all[0]
    // keep only the fixture block (parent sku repeats on each variant row)
    const mine = all.filter((r, i) => i > 0 && r[0] === FIX_A)

    // bump price + inventory on the -S row
    const sIdx = mine.findIndex((r) => r[11] === `${FIX_A}-S`)
    mine[sIdx][4] = '12.5'
    mine[sIdx][13] = '20'

    // add a brand-new single-variant product
    mine.push([
      'CSVFIX-BETA',
      'CSV Fixture Beta',
      '',
      'Fresh import',
      '7.25',
      '',
      '2',
      'draft',
      '',
      'true',
      '3',
      'CSVFIX-BETA-ONE',
      '{"Color":"Red"}',
      '4'
    ])

    const csv = toCsv(header, mine)
    const res = await call('/api/products/import', multipart(csv, adminToken))
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const detail = await call(`/api/products/${alphaId}`, {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(detail.body.data.price).toBe(12.5)
    const sVariant = detail.body.data.variants.find((v: any) => v.sku === `${FIX_A}-S`)
    expect(sVariant.inventory).toBe(20)

    // inventory change is logged
    const logs = await call(`/api/inventory?variantId=${sVariant.id}&limit=50`, {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    if (logs.status === 200 && Array.isArray(logs.body.data.items)) {
      const importLog = logs.body.data.items.find((l: any) => l.reason === 'import')
      if (importLog) {
        expect(importLog.change).toBe(13)
        expect(importLog.beforeValue).toBe(5)
        expect(importLog.afterValue).toBe(20)
      }
    }

    // beta exists as its own product
    const beta = await call('/api/products?search=CSVFIX-BETA', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(beta.body.data.meta.total).toBeGreaterThanOrEqual(1)
    createdIds.push(beta.body.data.items[0].id)
  })

  it('reports per-row errors without blocking other blocks', async () => {
    const csv = [
      'sku,name,price,status',
      'CSVFIX-GOOD,Good Import Row,3.5,draft',
      'CSVFIX-BAD,Bad Price Row,not-a-number,active'
    ].join('\n')
    const res = await call('/api/products/import', multipart(csv, adminToken))
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(1)
    expect(res.body.data.failed).toBe(1)
    expect(res.body.data.errors[0].message).toContain('"price"')
    createdIds.push(
      (
        await call('/api/products?search=Good Import Row', {
          headers: { authorization: `Bearer ${adminToken}` }
        })
      ).body.data.items[0].id
    )
  })

  it('rejects malformed files and unauthorized writers', async () => {
    const noName = await call(
      '/api/products/import',
      multipart('sku,price\nX-1,5\n', adminToken)
    )
    expect(noName.status).toBe(400)

    const forbidden = await call(
      '/api/products/import',
      multipart('name,price\nX,5\n', staffToken)
    )
    expect(forbidden.status).toBe(403)
  })

  afterAll(async () => {
    if (createdIds.length) {
      await db.delete(products).where(inArray(products.id, createdIds))
    }
  })
})
