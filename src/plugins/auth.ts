import { Elysia } from 'elysia'
import jwt from '@elysiajs/jwt'
import { and, eq, lt } from 'drizzle-orm'
import { db } from '../database/client'
import { merchants, tokenBlacklist, users } from '../database/schema'
import { unauthorized, forbidden } from '../shared/errors'
import type { UserRole, Permission } from '../shared/types'
import type { Merchant, User } from '../database/schema'

export const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me'
export const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me'

export const accessJwt = jwt({ name: 'accessJwt', secret: ACCESS_SECRET })
export const refreshJwt = jwt({ name: 'refreshJwt', secret: REFRESH_SECRET })

export interface AuthContext {
  user: User
  merchant: Merchant
}

export const isAdmin = (auth: AuthContext): boolean =>
  auth.user.role === 'owner' || auth.user.role === 'admin'

export const hasRole = (auth: AuthContext, ...roles: UserRole[]): boolean =>
  roles.includes(auth.user.role as UserRole)

export const hasPermission = (auth: AuthContext, ...perms: Permission[]): boolean =>
  isAdmin(auth) || perms.some((p) => auth.user.permissions.includes(p))

/** Hash a token so we never store raw JWTs on the blacklist. */
export const hashToken = (token: string) => {
  const buf = new TextEncoder().encode(token)
  const digest = Bun.CryptoHasher.hash('sha256', buf)
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Decode a base64url-encoded JWT payload segment (jose signs with base64url). */
const decodeTokenPayload = (token: string): Record<string, unknown> => {
  const segment = token.split('.')[1]
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4))
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
}

/** Revoke a token's jti by storing its hash until it expires. */
export const revokeToken = async (token: string, expiresAt: Date, userId?: string) => {
  const payload = decodeTokenPayload(token)
  const jti = String(payload.jti ?? '')
  const sub = String(payload.sub ?? userId ?? '')
  if (!jti) return
  await db
    .delete(tokenBlacklist)
    .where(eq(tokenBlacklist.jti, hashToken(jti)))
  await db.insert(tokenBlacklist).values({
    userId: sub,
    jti: hashToken(jti),
    expiresAt
  })
}

/** Returns true if the token jti has been revoked. Prunes expired rows opportunistically. */
export const isRevoked = async (token: string): Promise<boolean> => {
  const payload = decodeTokenPayload(token)
  const jti = String(payload.jti ?? '')
  if (!jti) return false
  await db.delete(tokenBlacklist).where(lt(tokenBlacklist.expiresAt, new Date()))
  const [row] = await db
    .select({ id: tokenBlacklist.id })
    .from(tokenBlacklist)
    .where(eq(tokenBlacklist.jti, hashToken(jti)))
  return !!row
}

export const authPlugin = new Elysia({ name: 'auth' })
  .use(accessJwt)
  .use(refreshJwt)
  .derive({ as: 'scoped' }, async ({ accessJwt, headers }): Promise<{ auth: AuthContext }> => {
    const token = headers.authorization?.startsWith('Bearer ')
      ? headers.authorization.slice(7)
      : undefined
    if (!token) throw unauthorized()

    const payload = await accessJwt.verify(token)
    if (!payload || !payload.sub || payload.type !== 'access') {
      throw unauthorized('Invalid or expired access token')
    }
    if (await isRevoked(token)) throw unauthorized('Session has been revoked')

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, String(payload.sub)), eq(users.status, 'active')))
    if (!user) throw unauthorized('User no longer exists')

    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.id, user.merchantId), eq(merchants.status, 'active')))
    if (!merchant) throw unauthorized('Store is not active')

    return { auth: { user, merchant } }
  })

/** Guard that runs BEFORE body validation (derive stage) so unauthorized
 * users get 403 instead of leaking validation errors. */
export const requirePermission = (...perms: Permission[]) =>
  new Elysia({ name: 'require-permission' })
    .use(authPlugin)
    .derive({ as: 'scoped' }, ({ auth }) => {
      if (!auth) throw unauthorized()
      if (!hasPermission(auth, ...perms)) throw forbidden()
    })