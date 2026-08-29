import { Elysia, t } from 'elysia'
import { accessJwt, refreshJwt, authPlugin, claimRefreshToken, revokeToken } from '../../plugins/auth'
import type { AuthContext } from '../../plugins/auth'
import { AuthService } from './service'
import { loginBody, refreshBody, logoutBody, tokenPair, meResponse } from './model'
import { unauthorized } from '../../shared/errors'
import { createId } from '@paralleldrive/cuid2'
import { auditFromRequest } from '../audit-logs'

export const ACCESS_TOKEN_TTL = 60 * 60 // 1 hour
export const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 7 // 7 days

export const REFRESH_COOKIE = 'md.refresh'

const cookieSchema = t.Cookie({ [REFRESH_COOKIE]: t.Optional(t.String()) })

const refreshCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_TTL
}

const expireRefreshCookie = {
  value: '',
  expires: new Date(0),
  maxAge: 0,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth'
}

export const authModule = new Elysia({ prefix: '/api/auth' })
  .use(accessJwt)
  .use(refreshJwt)
  .post(
    '/login',
    async ({ body, accessJwt, refreshJwt, cookie, request }) => {
      const result = await AuthService.login(body)
      const { user, merchant } = result.data
      auditFromRequest({ user, merchant } as AuthContext, request, {
        action: 'auth.login',
        entityType: 'auth',
        entityId: user.id
      })

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

      cookie[REFRESH_COOKIE]?.set({ value: refreshToken, ...refreshCookieOptions })

      return {
        success: true,
        data: {
          ...result.data,
          accessToken,
          refreshToken,
          expiresIn: ACCESS_TOKEN_TTL
        }
      }
    },
    { body: loginBody, response: tokenPair, cookie: cookieSchema }
  )
  .post(
    '/refresh',
    async ({ body, accessJwt, refreshJwt, cookie }) => {
      const token = body.refreshToken ?? cookie[REFRESH_COOKIE]?.value ?? ''
      if (!token) throw unauthorized('Invalid refresh token')

      const payload = await refreshJwt.verify(token)
      if (!payload || payload.type !== 'refresh' || !payload.jti) {
        throw unauthorized('Invalid refresh token')
      }

      // Atomically claim the old token — replayed tokens lose the race and are rejected here.
      const claimed = await claimRefreshToken(token, new Date(Number(payload.exp) * 1000))
      if (!claimed) {
        throw unauthorized('Refresh token has been revoked')
      }

      const session = await AuthService.session(String(payload.sub!))
      const { user, merchant } = session.data

      const jti = createId()
      const accessToken = await accessJwt.sign({
        sub: user.id,
        role: user.role,
        type: 'access',
        jti,
        exp: `${ACCESS_TOKEN_TTL}s`
      })
      const newRefreshToken = await refreshJwt.sign({
        sub: user.id,
        role: user.role,
        type: 'refresh',
        jti,
        exp: `${REFRESH_TOKEN_TTL}s`
      })

      // Rotation complete — the new pair is signed above with a fresh jti.
      cookie[REFRESH_COOKIE]?.set({ value: newRefreshToken, ...refreshCookieOptions })

      return {
        success: true,
        data: {
          user,
          merchant,
          accessToken,
          refreshToken: newRefreshToken,
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
        }
      }
      cookie[REFRESH_COOKIE]?.set(expireRefreshCookie)
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
