import { createHash, randomBytes } from 'node:crypto'
import { and, count, desc, eq } from 'drizzle-orm'
import type { DB } from '../../database/client'
import { apiKeys } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, notFound } from '../../shared/errors'
import { API_KEY_SCOPES } from '../../shared/types'
import { makeMeta, parsePagination } from '../../shared/pagination'
import { constantTimeEqual } from '../../shared/crypto'

const SK_PREFIX = 'ecom_'

/** Default scopes for keys created without an explicit list. */
export const DEFAULT_API_KEY_SCOPES: string[] = ['orders:read', 'products:read']

/** Reject any scope outside the API_KEY_SCOPES vocabulary. */
export const assertValidScopes = (scopes: readonly string[]): void => {
  const allowed = API_KEY_SCOPES as readonly string[]
  const unknown = scopes.filter((s) => !allowed.includes(s))
  if (unknown.length > 0) {
    throw badRequest('INVALID_API_KEY_SCOPE', `Unknown API key scope(s): ${unknown.join(', ')}`)
  }
}

export class ApiKeysService {
  static async list(db: DB, merchantId: string, query: { page?: string; limit?: string } = {}) {
    const { page, limit, offset } = parsePagination(query)
    const where = eq(apiKeys.merchantId, merchantId)
    const [rows, totalRows] = await Promise.all([
      db.select().from(apiKeys).where(where).orderBy(desc(apiKeys.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(apiKeys).where(where)
    ])
    const total = totalRows[0]?.total ?? 0
    return ok({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        keyPrefix: r.keyPrefix,
        scopes: r.scopes,
        status: r.status,
        lastUsedAt: r.lastUsedAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        createdAt: r.createdAt
      })),
      meta: makeMeta(page, limit, total)
    })
  }

  static async create(
    db: DB,
    merchantId: string,
    input: { name: string; scopes?: string[]; expiresAt?: Date }
  ) {
    const scopes = input.scopes ?? DEFAULT_API_KEY_SCOPES
    assertValidScopes(scopes)

    const secret = randomBytes(32).toString('hex') // 64 hex chars
    const prefix = `${SK_PREFIX}${createHash('sha1').update(secret).digest('hex').slice(0, 8)}`
    const secretHash = this.hashSecret(secret)

    const [row] = await db
      .insert(apiKeys)
      .values({
        merchantId,
        name: input.name,
        keyPrefix: prefix,
        secretHash,
        scopes,
        status: 'active',
        expiresAt: input.expiresAt ?? null
      })
      .returning()

    // Return the plaintext secret exactly once.
    return ok({ key: row, secret: `${prefix}.${secret}` })
  }

  static async revoke(db: DB, merchantId: string, id: string) {
    const [row] = await db
      .update(apiKeys)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.merchantId, merchantId)))
      .returning()
    if (!row) throw notFound('API_KEY_NOT_FOUND', 'API key not found')
    return ok({ id: row.id, status: row.status })
  }

  static async resolve(db: DB, providedKey: string): Promise<{ id: string; name: string; merchant: string; scopes: string[] } | null> {
    const [prefix, secret] = splitKey(providedKey)
    if (!prefix || !secret) return null

    const secretHash = this.hashSecret(secret)
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, prefix))
    if (!row || row.status !== 'active' || !constantTimeEqual(row.secretHash, secretHash)) return null
    if (row.expiresAt && row.expiresAt < new Date()) return null

    // Touch lastUsedAt (async, don't block request).
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => {})

    return { id: row.id, name: row.name, merchant: row.merchantId, scopes: row.scopes }
  }

  static hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex')
  }
}

const splitKey = (key: string): [string, string] => {
  const dot = key.indexOf('.')
  if (dot === -1) return ['', '']
  return [key.slice(0, dot), key.slice(dot + 1)]
}
