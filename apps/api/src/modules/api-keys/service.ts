import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { apiKeys } from '../../database/schema'
import { ok } from '../../shared/response'
import { notFound } from '../../shared/errors'
import { makeMeta, parsePagination } from '../../shared/pagination'

const SK_PREFIX = 'ecom_'

export class ApiKeysService {
  static async list(merchantId: string, query: { page?: string; limit?: string } = {}) {
    const { page, limit, offset } = parsePagination(query)
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.merchantId, merchantId))
      .orderBy(desc(apiKeys.createdAt))
      .limit(limit)
      .offset(offset)
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
      meta: makeMeta(page, limit, rows.length)
    })
  }

  static async create(
    merchantId: string,
    input: { name: string; scopes?: string[]; expiresAt?: Date }
  ) {
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
        scopes: input.scopes ?? ['read:orders', 'read:products'],
        status: 'active',
        expiresAt: input.expiresAt ?? null
      })
      .returning()

    // Return the plaintext secret exactly once.
    return ok({ key: row, secret: `${prefix}.${secret}` })
  }

  static async revoke(merchantId: string, id: string) {
    const [row] = await db
      .update(apiKeys)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.merchantId, merchantId)))
      .returning()
    if (!row) throw notFound('API_KEY_NOT_FOUND', 'API key not found')
    return ok({ id: row.id, status: row.status })
  }

  static async resolve(providedKey: string): Promise<{ merchant: string; scopes: string[] } | null> {
    const [prefix, secret] = splitKey(providedKey)
    if (!prefix || !secret) return null

    const secretHash = this.hashSecret(secret)
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, prefix))
    if (!row || row.status !== 'active' || row.secretHash !== secretHash) return null
    if (row.expiresAt && row.expiresAt < new Date()) return null

    // Touch lastUsedAt (async, don't block request).
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => {})

    return { merchant: row.merchantId, scopes: row.scopes }
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
