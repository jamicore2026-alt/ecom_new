import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { customers } from '../src/database/schema'
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

const multipart = (csv: string, token?: string) => {
  const form = new FormData()
  form.append('file', new File([csv], 'import.csv', { type: 'text/csv' }))
  return {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body: form
  }
}

const CUSTOMER_HEADERS = [
  'email',
  'first_name',
  'last_name',
  'phone',
  'orders_count',
  'total_spent',
  'registered_at',
  'last_order_at'
]

const ORDER_HEADERS = [
  'order_id',
  'order_number',
  'status',
  'payment_status',
  'fulfillment_status',
  'customer_email',
  'customer_name',
  'subtotal',
  'shipping_total',
  'discount_total',
  'tax_total',
  'total',
  'currency',
  'payment_method',
  'item_count',
  'created_at'
]

const NEW_EMAIL = 'csvcust-new@acme.com'
const ERR_EMAIL = 'csvcust-err@acme.com'
const createdEmails: string[] = []

describe('Customers + Orders CSV export/import', () => {
  let adminToken = ''
  let staffToken = ''

  beforeAll(async () => {
    const login = await call('/api/auth/login', json({ email: 'admin@acme.com', password: 'password123' }))
    adminToken = login.body.data.accessToken
    const staffLogin = await call('/api/auth/login', json({ email: 'riley@acme.com', password: 'password123' }))
    staffToken = staffLogin.body.data.accessToken
  })

  it('exports customers as RFC4180 CSV with header + one row per customer', async () => {
    const res = await raw('/api/customers/export', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(res.status).toBe(200)
    expect(res.res.headers.get('content-type')).toContain('text/csv')
    expect(res.res.headers.get('content-disposition')).toContain('customers-acme-store-')
    const rows = parseCsv(await res.res.text())
    expect(rows[0]).toEqual(CUSTOMER_HEADERS)
    expect(rows.length).toBeGreaterThan(1)

    // staff (read-only) can also export
    const staffRes = await raw('/api/customers/export', {
      headers: { authorization: `Bearer ${staffToken}` }
    })
    expect(staffRes.status).toBe(200)
    expect(parseCsv(await staffRes.res.text()).length).toBe(rows.length)

    // unauthenticated is rejected
    const anon = await raw('/api/customers/export')
    expect(anon.status).toBe(401)
  })

  it('exports orders as RFC4180 CSV with header + at least one order row', async () => {
    const res = await raw('/api/orders/export', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(res.status).toBe(200)
    expect(res.res.headers.get('content-type')).toContain('text/csv')
    expect(res.res.headers.get('content-disposition')).toContain('orders-acme-store-')
    const rows = parseCsv(await res.res.text())
    expect(rows[0]).toEqual(ORDER_HEADERS)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows.slice(1)) {
      expect(row.length).toBe(ORDER_HEADERS.length)
    }
    // numeric columns are present on the first data row
    const first = rows[1]
    expect(first[2]).not.toBe('')
    expect(first[11]).not.toBe('')

    // staff (read-only) can also export
    const staffRes = await raw('/api/orders/export', {
      headers: { authorization: `Bearer ${staffToken}` }
    })
    expect(staffRes.status).toBe(200)
    expect(parseCsv(await staffRes.res.text()).length).toBe(rows.length)

    // unauthenticated is rejected
    const anon = await raw('/api/orders/export')
    expect(anon.status).toBe(401)
  })

  it('imports create + update by email', async () => {
    const csv = [
      CUSTOMER_HEADERS.join(','),
      `${NEW_EMAIL},New,Person,5550001`,
      `${NEW_EMAIL},Updated,Person,5550002`
    ].join('\n')
    createdEmails.push(NEW_EMAIL)
    const res = await call('/api/customers/import', multipart(csv, adminToken))
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.created).toBe(1)
    expect(res.body.data.updated).toBe(1)
    expect(res.body.data.failed).toBe(0)

    const exp = await raw('/api/customers/export', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    const rows = parseCsv(await exp.res.text())
    const mine = rows.find((r) => r[0] === NEW_EMAIL)
    expect(mine).toBeDefined()
    expect(mine?.[1]).toBe('Updated')
    expect(mine?.[2]).toBe('Person')
    expect(mine?.[3]).toBe('5550002')
  })

  it('round-trips an export through import (header row + unchanged rows re-import cleanly)', async () => {
    const exp = await raw('/api/customers/export', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    const all = parseCsv(await exp.res.text())
    const header = all[0]
    const data = all.slice(1)
    expect(header).toEqual(CUSTOMER_HEADERS)

    const csv = toCsv(header, data)
    const res = await call('/api/customers/import', multipart(csv, adminToken))
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(0)
    expect(res.body.data.errors.length).toBe(0)

    // the previously-created customer survives the round trip
    const re = await raw('/api/customers/export', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    const rows = parseCsv(await re.res.text())
    const mine = rows.find((r) => r[0] === NEW_EMAIL)
    expect(mine?.[1]).toBe('Updated')
  })

  it('reports per-row errors for missing/invalid email without blocking good rows', async () => {
    const csv = [
      'email,first_name',
      ',Missing Email',
      'not-an-email,Bad Email',
      `${ERR_EMAIL},Good Person`
    ].join('\n')
    createdEmails.push(ERR_EMAIL)
    const res = await call('/api/customers/import', multipart(csv, adminToken))
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(1)
    expect(res.body.data.failed).toBe(2)
    expect(res.body.data.errors[0]).toMatchObject({ line: 2 })
    expect(res.body.data.errors[0].message).toContain('Missing required "email"')
    expect(res.body.data.errors[1]).toMatchObject({ line: 3 })
    expect(res.body.data.errors[1].message).toContain('Invalid email')
  })

  it('rejects malformed files and unauthorized writers', async () => {
    const noHeader = await call(
      '/api/customers/import',
      multipart('first_name\nNo Email Here\n', adminToken)
    )
    expect(noHeader.status).toBe(400)

    const forbidden = await call(
      '/api/customers/import',
      multipart('email,first_name\nfoo@bar.com,X\n', staffToken)
    )
    expect(forbidden.status).toBe(403)

    const anon = await call('/api/customers/import', multipart('email\nx@y.com\n'))
    expect(anon.status).toBe(401)
  })

  afterAll(async () => {
    if (createdEmails.length) {
      const rows = await db
        .select()
        .from(customers)
        .where(inArray(customers.email, createdEmails))
      // delete only the merchant-scoped rows this test created
      const merchantIds = [...new Set(rows.map((r) => r.merchantId))]
      for (const merchantId of merchantIds) {
        const ids = rows.filter((r) => r.merchantId === merchantId).map((r) => r.id)
        await db.delete(customers).where(inArray(customers.id, ids))
      }
    }
  })
})