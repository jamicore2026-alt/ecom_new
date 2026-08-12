import { Elysia } from 'elysia'
import { accessJwt, refreshJwt, authPlugin, isRevoked, revokeToken } from '../../plugins/auth'
import { AuthService } from './service'
import { loginBody, refreshBody, logoutBody, tokenPair, meResponse } from './model'
import { unauthorized, badRequest } from '../../shared/errors'
import { createId } from '@paralleldrive/cuid2'

export const ACCESS_TOKEN_TTL = 60 * 60 // 1 hour
export const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 7 // 7 days

const now = () => new Date()
const tokenExpiry = (ttl: number) => new Date(Date.now() + ttl * 1000)

export const authModule = new Elysia({ prefix: '/api/auth' })
  .use(accessJwt)
  .use(refreshJwt)
  .post(
    '/login',
    async ({ body, accessJwt, refreshJwt }) => {
      const result = await AuthService.login(body)
      const { user, merchant } = result.data

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
    { body: loginBody, response: tokenPair }
  )
  .post(
    '/refresh',
    async ({ body, accessJwt, refreshJwt }) => {
      const payload = await refreshJwt.verify(body.refreshToken)
      if (!payload || payload.type !== 'refresh' || !payload.jti) {
        throw unauthorized('Invalid refresh token')
      }
      if (await isRevoked(body.refreshToken)) {
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

      // Rotate: revoke the old refresh token so it can't be replayed
      await revokeToken(body.refreshToken, new Date(Number(payload.exp) * 1000), user.id)

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
    { body: refreshBody, response: tokenPair }
  )
  .post(
    '/logout',
    async ({ body, refreshJwt }) => {
      const payload = body.refreshToken ? await refreshJwt.verify(body.refreshToken) : null
      if (payload && payload.jti) {
        await revokeToken(
          body.refreshToken as string,
          new Date(Number(payload.exp) * 1000),
          String(payload.sub ?? '')
        )
      }
      return { success: true, data: { message: 'Signed out successfully' } }
    },
    { body: logoutBody }
  )
  .use(authPlugin)
  .get(
    '/me',
    async ({ auth }) => AuthService.session(auth.user.id),
    { response: meResponse }
  )