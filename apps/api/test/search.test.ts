import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/database/client'
import { merchants, products } from '../src/database/schema'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json()
  return { status: res.status, body }
}

const json = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
})

describe('Product full-text search', () => {
  let adminToken = ''
  let otherStoreId = ''
  const createdIds: string[] = []

  const create = async (name: string, description: string) => {
    const res = await call(
      '/api/products',
      json({ name, price: 9.99, description, status: 'active' }, adminToken)
    )
    expect(res.status).toBe(200)
    createdIds.push(res.body.data.id)
    return res.body.data
  }

  beforeAll(async () => {
    const inserted = await db
      .insert(merchants)
      .values({ name: 'Other Store', slug: 'other-store', email: 'other@example.com' })
      .onConflictDoNothing()
      .returning({ id: merchants.id })
    otherStoreId = inserted[0]?.id ?? ''

    const login = await call('/api/auth/login', json({ email: 'admin@acme.com', password: 'password123' }))
    expect(login.status).toBe(200)
    adminToken = login.body.data.accessToken

    // Deterministic fixtures: two products share the lexeme "quantum",
    // one matches both query words so it must rank first.
    await create('Quantum Flux Capacitor', 'Channels quantum flux for time travel.')
    await create('Flux Charger', 'A simple charger with no special powers.')
    await create('Boring Pebble', 'Just a pebble.')
  })

  it('matches words in any order (tsvector, not substring)', async () => {
    const fwd = await call('/api/store/acme-store/search?search=flux+quantum')
    expect(fwd.status).toBe(200)
    expect(fwd.body.data.meta.total).toBeGreaterThanOrEqual(1)
    expect(fwd.body.data.items.some((i: any) => i.name === 'Quantum Flux Capacitor')).toBe(true)

    const rev = await call('/api/store/acme-store/search?search=quantum+flux')
    expect(rev.body.data.meta.total).toBe(fwd.body.data.meta.total)
  })

  it('ranks multi-lexeme matches above single-lexeme ones', async () => {
    const res = await call('/api/store/acme-store/search?search=flux+quantum')
    expect(res.body.data.items[0].name).toBe('Quantum Flux Capacitor')

    const merchantList = await call('/api/products?search=flux+quantum', {
      headers: { authorization: `Bearer ${adminToken}` }
    })
    expect(merchantList.status).toBe(200)
    expect(merchantList.body.data.items[0].name).toBe('Quantum Flux Capacitor')
  })

  it('falls back to prefix matching when FTS misses', async () => {
    const res = await call('/api/store/acme-store/search?search=capac')
    expect(res.status).toBe(200)
    expect(res.body.data.items.some((i: any) => i.name === 'Quantum Flux Capacitor')).toBe(true)
  })

  it('never leaks other stores or non-active products', async () => {
    const draft = await call(
      '/api/products',
      json({ name: 'Secret Quantum Prototype', price: 1, status: 'draft' }, adminToken)
    )
    expect(draft.status).toBe(200)
    createdIds.push(draft.body.data.id)

    const res = await call('/api/store/acme-store/search?search=secret+quantum')
    expect(res.body.data.items.find((i: any) => i.name === 'Secret Quantum Prototype')).toBeUndefined()

    const other = await call('/api/store/other-store/search?search=quantum')
    expect(other.body.data.items).toHaveLength(0)

    const merchantScoped = await call('/api/store/acme-store/search?search=pebble')
    expect(merchantScoped.body.data.items[0]?.name).toBe('Boring Pebble')
  })

  afterAll(async () => {
    if (createdIds.length) {
      await db.delete(products).where(inArray(products.id, createdIds))
    }
    if (otherStoreId) {
      await db.delete(merchants).where(eq(merchants.slug, 'other-store'))
    }
  })
})
