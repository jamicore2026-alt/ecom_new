import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import { db } from '../../database/client'
import { sessions, users } from '../../database/schema'
import { accessJwt, refreshJwt, authPlugin, claimRefreshToken, revokeToken, hashToken } from '../../plugins/auth'
import { AuthService } from './service'
import { loginBody, refreshBody, logoutBody, tokenPair, loginResponse, mfaVerifyBody, meResponse } from './model'
import { unauthorized } from '../../shared/errors'
import { createId } from '@paralleldrive/cuid2'
import { randomBytes } from 'node:crypto'
import { auditFromRequest } from '../audit-logs'
import {
  MfaService,
  assertSessionUsable,
  recordSession,
  revokeSessionRow,
  signMfaToken,
  verifyMfaToken
} from '../mfa/service'

export const ACCESS_TOKEN_TTL = 60 * 60 // 1 hour
export const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 7 // 7 days

export const REFRESH_COOKIE = 'md.refresh'
/** httpOnly access-token cookie (browser dashboard flow). Bearer header stays
 *  supported for API clients and tests. */
export const ACCESS_COOKIE = 'md.access'
/** Readable double-submit CSRF cookie paired with md.access. */
export const CSRF_COOKIE = 'md.csrf'

const cookieSchema = t.Cookie({
  [REFRESH_COOKIE]: t.Optional(t.String()),
  [ACCESS_COOKIE]: t.Optional(t.String()),
  [CSRF_COOKIE]: t.Optional(t.String())
})

const accessCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: ACCESS_TOKEN_TTL
}

const csrfCookieOptions = {
  httpOnly: false,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: REFRESH_TOKEN_TTL
}

const refreshCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: REFRESH_TOKEN_TTL
}

const clientInfo = (request: Request) => {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0].trim() : null
  const userAgent = request.headers.get('user-agent')
  return { ip, userAgent }
}

interface TokenPair {
  accessToken: string
  refreshToken: string
  csrfToken: string
  jti: string
}

interface JwtSigner {
  sign(p: Record<string, string>): Promise<string>
}

const issueTokenPair = async (
  accessJwt: JwtSigner,
  refreshJwt: JwtSigner,
  user: { id: string; role: string }
): Promise<TokenPair> => {
  const jti = createId()
  const accessToken = await accessJwt.sign({
    sub: user.id,
    role: user.role,
    type: 'access',
    jti,
    exp: `${ACCESS_TOKEN_TTL}s`
  })
  const refreshToken = await refreshJwt.sign({
    sub: user.id,
    role: user.role,
    type: 'refresh',
    jti,
    exp: `${REFRESH_TOKEN_TTL}s`
  })
  return { accessToken, refreshToken, csrfToken: hashToken(jti), jti }
}

const setAuthCookies = (
  cookie: Record<string, { set: (v: Record<string, unknown>) => void } | undefined>,
  pair: TokenPair
) => {
  cookie[REFRESH_COOKIE]?.set({ value: pair.refreshToken, ...refreshCookieOptions })
  // Browser flow: httpOnly access cookie + readable double-submit CSRF
  // cookie. JSON tokens stay in the body for non-browser API clients.
  const csrfPair = randomBytes(32).toString('hex')
  cookie[ACCESS_COOKIE]?.set({ value: pair.accessToken, ...accessCookieOptions })
  cookie[CSRF_COOKIE]?.set({ value: csrfPair, ...csrfCookieOptions })
}

const expireRefreshCookie = {
  value: '',
  expires: new Date(0),
  maxAge: 0,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/'
}

export const authModule = new Elysia({ prefix: '/api/auth' })
  .use(accessJwt)
  .use(refreshJwt)
  .post(
    '/login',
    async ({ body, accessJwt, refreshJwt, cookie, request }) => {
      const result = await AuthService.login(body)
      const { user, merchant } = result.data

      // MFA challenge: password passed but no tokens are issued until the
      // second factor is verified via POST /api/auth/mfa/verify.
      const [fullUser] = await db.select().from(users).where(eq(users.id, user.id))
      if (fullUser?.mfaEnabled) {
        return { success: true as const, data: { mfaRequired: true as const, mfaToken: signMfaToken(user.id, merchant.id) } }
      }

      await auditFromRequest({ user, merchant }, request, {
        action: 'auth.login',
        entityType: 'auth',
        entityId: user.id
      })

      const pair = await issueTokenPair(accessJwt, refreshJwt, user)
      setAuthCookies(cookie as never, pair)

      const { ip, userAgent } = clientInfo(request)
      await recordSession({
        merchantId: merchant.id,
        userId: user.id,
        jti: pair.jti,
        ip,
        userAgent,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000)
      })

      return {
        success: true,
        data: {
          ...result.data,
          accessToken: pair.accessToken,
          refreshToken: pair.refreshToken,
          csrfToken: pair.csrfToken,
          expiresIn: ACCESS_TOKEN_TTL
        }
      }
    },
    { body: loginBody, response: loginResponse, cookie: cookieSchema }
  )
  .post(
    '/mfa/verify',
    async ({ body, accessJwt, refreshJwt, cookie, request }) => {
      const challenge = verifyMfaToken(body.mfaToken)
      const checked = await MfaService.verifyLoginChallenge(challenge.sub, {
        code: body.code,
        backupCode: body.backupCode
      })
      const session = await AuthService.session(challenge.sub)
      const { user, merchant } = session.data
      await auditFromRequest({ user, merchant }, request, {
        action: checked.data.usedBackupCode ? 'auth.login.mfa_backup' : 'auth.login.mfa',
        entityType: 'auth',
        entityId: user.id
      })

      const pair = await issueTokenPair(accessJwt, refreshJwt, user)
      setAuthCookies(cookie as never, pair)

      const { ip, userAgent } = clientInfo(request)
      await recordSession({
        merchantId: merchant.id,
        userId: user.id,
        jti: pair.jti,
        ip,
        userAgent,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000)
      })

      return {
        success: true,
        data: {
          user,
          merchant,
          accessToken: pair.accessToken,
          refreshToken: pair.refreshToken,
          csrfToken: pair.csrfToken,
          expiresIn: ACCESS_TOKEN_TTL
        }
      }
    },
    { body: mfaVerifyBody, response: tokenPair, cookie: cookieSchema }
  )
  .post(
    '/refresh',
    async ({ body, accessJwt, refreshJwt, cookie, headers, request }) => {
      const fromCookie = !body.refreshToken && !!cookie[REFRESH_COOKIE]?.value
      const token = body.refreshToken ?? cookie[REFRESH_COOKIE]?.value ?? ''
      if (!token) throw unauthorized('Invalid refresh token')

      const payload = await refreshJwt.verify(token)
      if (!payload || payload.type !== 'refresh' || !payload.jti) {
        throw unauthorized('Invalid refresh token')
      }

      // CSRF check: X-CSRF-Token must match hash of the refresh token's jti.
      // This prevents same-site form-based CSRF attacks on the refresh endpoint.
      // Required when the token comes from the cookie (browser flow); optional
      // for body-token callers (bearer-style API clients).
      const csrfHeader = headers['x-csrf-token']
      if (fromCookie && csrfHeader !== hashToken(payload.jti)) {
        throw unauthorized('Invalid CSRF token')
      }
      if (!fromCookie && csrfHeader && csrfHeader !== hashToken(payload.jti)) {
        throw unauthorized('Invalid CSRF token')
      }

      // Atomically claim the old token — replayed tokens lose the race and are rejected here.
      const claimed = await claimRefreshToken(token, new Date(Number(payload.exp) * 1000))
      if (!claimed) {
        throw unauthorized('Refresh token has been revoked')
      }

      // Reject refreshes for sessions that were revoked or expired via the
      // session inventory (per-device logout / admin revoke).
      const { row: sessionRow } = await assertSessionUsable(String(payload.jti))

      const session = await AuthService.session(String(payload.sub!))
      const { user, merchant } = session.data

      const pair = await issueTokenPair(accessJwt, refreshJwt, user)

      // Rotation complete — the new pair is signed above with a fresh jti.
      setAuthCookies(cookie as never, pair)

      // Rotate the session row onto the new jti (refresh keeps one row per
      // device) and refresh lastSeenAt; legacy tokens without a row get one.
      const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000)
      if (sessionRow) {
        await db
          .update(sessions)
          .set({ jtiHash: hashToken(pair.jti), lastSeenAt: new Date(), expiresAt: newExpiresAt })
          .where(eq(sessions.jtiHash, hashToken(String(payload.jti))))
      } else {
        const { ip, userAgent } = clientInfo(request)
        await recordSession({
          merchantId: merchant.id,
          userId: user.id,
          jti: pair.jti,
          ip,
          userAgent,
          expiresAt: newExpiresAt
        })
      }

      return {
        success: true,
        data: {
          user,
          merchant,
          accessToken: pair.accessToken,
          refreshToken: pair.refreshToken,
          csrfToken: pair.csrfToken,
          expiresIn: ACCESS_TOKEN_TTL
        }
      }
    },
    { body: refreshBody, response: tokenPair, cookie: cookieSchema }
  )
  .post(
    '/logout',
    async ({ body, refreshJwt, cookie }) => {
      const token = body?.refreshToken ?? cookie[REFRESH_COOKIE]?.value ?? null
      if (token) {
        const payload = await refreshJwt.verify(token)
        if (payload && payload.jti) {
          await revokeToken(token, new Date(Number(payload.exp) * 1000), String(payload.sub ?? ''))
          // Mark the session row revoked so the inventory reflects the logout
          // even if the blacklist entry is pruned before the session expires.
          await revokeSessionRow(
            hashToken(String(payload.jti)),
            new Date(Number(payload.exp) * 1000),
            String(payload.sub ?? '')
          )
        }
      }
      cookie[REFRESH_COOKIE]?.set(expireRefreshCookie)
      cookie[ACCESS_COOKIE]?.set({ ...expireRefreshCookie })
      cookie[CSRF_COOKIE]?.set({ ...expireRefreshCookie, httpOnly: false })
      return { success: true, data: { message: 'Signed out successfully' } }
    },
    { body: t.Optional(logoutBody), cookie: cookieSchema }
  )
  .use(authPlugin)
  .get(
    '/me',
    async ({ auth }) => AuthService.session(auth.user.id),
    { response: meResponse }
  )
