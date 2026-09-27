import { Elysia, t } from 'elysia'
import jwt from '@elysiajs/jwt'
import { randomBytes } from 'node:crypto'
import { PlatformService } from './service'
import { platformLoginBody, platformStatusBody, platformListQuery, platformIdParams, platformCreateMerchantBody } from './model'
import { resolveSecret } from '../../plugins/auth'
import { ok } from '../../shared/response'
import { forbidden, unauthorized } from '../../shared/errors'

/**
 * Platform (super admin) session cookie — kept completely separate from the
 * merchant session: distinct cookie name, distinct signing secret, distinct
 * verification path. A merchant session can never satisfy a platform check.
 */
export const PLATFORM_COOKIE = 'pd.session'
/** Readable double-submit CSRF cookie paired with pd.session. */
export const PLATFORM_CSRF_COOKIE = 'pd.csrf'
const SESSION_TTL = 60 * 60 // 1 hour

const PLATFORM_JWT_SECRET = resolveSecret('PLATFORM_JWT_SECRET', 'dev-platform-secret-change-me')

const cookieSchema = t.Cookie({
  [PLATFORM_COOKIE]: t.Optional(t.String()),
  [PLATFORM_CSRF_COOKIE]: t.Optional(t.String())
})

const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  // Path '/' so the SvelteKit hooks gate can see session presence for
  // /platform/* pages. Real access control still happens on the API, which
  // verifies the signed, exp-scoped JWT on every protected request.
  path: '/',
  maxAge: SESSION_TTL
}

const csrfCookieOptions = {
  httpOnly: false,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL
}

const expireCookie = {
  value: '',
  expires: new Date(0),
  maxAge: 0,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/'
}

const expireCsrfCookie = { ...expireCookie, httpOnly: false }

export const platformJwt = jwt({ name: 'platformJwt', secret: PLATFORM_JWT_SECRET })

export const platformAuth = new Elysia({ name: 'platform-auth' })
  .use(platformJwt)
  .derive({ as: 'scoped' }, async ({ platformJwt, request, cookie, headers }) => {
    const raw = request.headers.get('cookie') ?? ''
    const prefix = `${PLATFORM_COOKIE}=`
    const token = raw
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(prefix))
      ?.slice(prefix.length)
    if (!token) throw unauthorized('Please sign in')
    const payload = await platformJwt.verify(token)
    if (!payload || !payload.sub || payload.type !== 'platform') {
      throw unauthorized('Invalid or expired session')
    }
    // Double-submit CSRF for cookie-authenticated state-changing requests,
    // mirroring the merchant auth baseline.
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrfCookie = (cookie as Record<string, { value?: string } | undefined>)[PLATFORM_CSRF_COOKIE]?.value
      const csrfHeader = (headers as Record<string, string | undefined>)['x-csrf-token']
      if (!csrfCookie || !csrfHeader || csrfHeader !== csrfCookie) {
        throw forbidden('Invalid CSRF token')
      }
    }
    return { platformAdmin: { id: String(payload.sub), email: String(payload.email ?? '') } }
  })

export const platformModule = new Elysia({ prefix: '/api/platform' })
  .use(platformJwt)
  .post(
    '/auth/login',
    async ({ body, cookie, platformJwt }) => {
      const admin = await PlatformService.login(body.email, body.password)
      const token = await platformJwt.sign({
        sub: admin.id,
        email: admin.email,
        type: 'platform',
        exp: `${SESSION_TTL}s`
      })
      const csrfPair = randomBytes(32).toString('hex')
      cookie[PLATFORM_COOKIE]?.set({ value: token, ...sessionCookieOptions })
      cookie[PLATFORM_CSRF_COOKIE]?.set({ value: csrfPair, ...csrfCookieOptions })
      return ok({ email: admin.email })
    },
    {
      body: platformLoginBody,
      cookie: cookieSchema,
      detail: { tags: ['Platform'], summary: 'Platform admin login (sets pd.session cookie)' }
    }
  )
  .post(
    '/auth/logout',
    ({ cookie }) => {
      cookie[PLATFORM_COOKIE]?.set(expireCookie)
      cookie[PLATFORM_CSRF_COOKIE]?.set(expireCsrfCookie)
      return ok({ message: 'Signed out' })
    },
    {
      cookie: cookieSchema,
      detail: { tags: ['Platform'], summary: 'Platform admin logout' }
    }
  )
  .use(platformAuth)
  .post(
    '/merchants',
    ({ body, platformAdmin }) => PlatformService.createMerchant(body, platformAdmin),
    {
      body: platformCreateMerchantBody,
      detail: { tags: ['Platform'], summary: 'Create a merchant with owner login + defaults (audited)' }
    }
  )
  .get(
    '/merchants',
    ({ query }) => PlatformService.listMerchants(query),
    {
      query: platformListQuery,
      detail: { tags: ['Platform'], summary: 'List all merchants (cross-tenant)' }
    }
  )
  .get(
    '/merchants/:id',
    ({ params }) => PlatformService.getMerchant(params.id),
    {
      params: platformIdParams,
      detail: {
        tags: ['Platform'],
        summary: 'Merchant detail + allowed next statuses + recent audit tail'
      }
    }
  )
  .post(
    '/merchants/:id/status',
    ({ params, body, platformAdmin }) =>
      PlatformService.changeStatus(params.id, body.to, body.reason, platformAdmin),
    {
      params: platformIdParams,
      body: platformStatusBody,
      detail: { tags: ['Platform'], summary: 'Change merchant lifecycle status (audited)' }
    }
  )
  .get(
    '/merchants/:id/modules',
    ({ params }) => PlatformService.listModulesForMerchant(params.id),
    {
      params: platformIdParams,
      detail: { tags: ['Platform'], summary: 'List module toggles for a merchant' }
    }
  )
  .put(
    '/merchants/:id/modules',
    ({ params, body, platformAdmin }) =>
      PlatformService.setMerchantModule(params.id, body.module, body.enabled, platformAdmin),
    {
      params: platformIdParams,
      body: t.Object({
        module: t.String({ minLength: 1, maxLength: 30 }),
        enabled: t.Boolean()
      }),
      detail: { tags: ['Platform'], summary: 'Toggle a module for a merchant (audited)' }
    }
  )