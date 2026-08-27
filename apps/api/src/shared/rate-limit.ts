import type { Elysia } from 'elysia'

/**
 * Minimal in-memory sliding-window rate limiter (single-node).
 * For multi-instance deployments put limits at the reverse proxy / gateway.
 */

interface Rule {
  test: (pathname: string, method: string) => boolean
  max: number
}

const WINDOW_MS = 60_000

const RULES: Rule[] = [
  // Auth surfaces — strictest.
  { test: (p) => p === '/api/auth/login', max: 10 },
  { test: (p) => p === '/api/auth/refresh' || p === '/api/auth/logout', max: 60 },
  { test: (p) => /^\/api\/store\/[^/]+\/auth\/(register|login|password)$/.test(p), max: 10 },
  // Password reset + email verification — strict (anti enumeration, anti-email-bomb).
  { test: (p) => /^\/api\/store\/[^/]+\/auth\/(forgot-password|reset-password|resend-verification|verify-email)/.test(p), max: 10 },
  { test: (p) => p.startsWith('/api/auth'), max: 30 },
  // Public order lookup leaks order/shipment details with only the order
  // number as proof — throttle enumeration harder than checkout itself.
  { test: (p, m) => m === 'GET' && /^\/api\/store\/[^/]+\/orders\/[^/]+$/.test(p), max: 10 },
  { test: (p) => p.endsWith('/checkout') || p.endsWith('/checkout/pay') || p.endsWith('/checkout/preview'), max: 30 },
  { test: (p) => p.endsWith('/orders') && p.includes('/checkout'), max: 30 },
  { test: (p) => p.endsWith('/sync', ), max: 30 },
  // Funnel events are fire-and-forget from browsers — allow bursts but bounded.
  { test: (p) => p.endsWith('/events'), max: 60 },
  // Provider webhooks retry aggressively on failure — generous but capped.
  { test: (p) => p.startsWith('/api/webhooks/'), max: 240 }
]

/** path → windowStart → request timestamps per ip+rule */
const buckets = new Map<string, number[]>()

let lastSweep = Date.now()
const sweep = () => {
  const cutoff = Date.now() - WINDOW_MS
  for (const [key, hits] of buckets) {
    const fresh = hits.filter((t) => t > cutoff)
    if (fresh.length === 0) buckets.delete(key)
    else buckets.set(key, fresh)
  }
  lastSweep = Date.now()
}

export const rateLimiter = (app: Elysia) =>
  app.onRequest(({ request, server, set }) => {
    // Test suites share one process and would trip per-IP limits.
    if (process.env.NODE_ENV === 'test') return

    const { pathname } = new URL(request.url)
    const method = request.method
    const rule = RULES.find((r) => r.test(pathname, method))
    if (!rule) return

    const now = Date.now()
    if (now - lastSweep > WINDOW_MS) sweep()

    // x-forwarded-for is honored by default because every supported topology
    // (dev vite proxy, Coolify/Traefik) sits behind a proxy that sets it.
    // Set TRUST_PROXY=false when the API port is exposed directly to the
    // internet — otherwise attackers can rotate spoofed XFF values to get a
    // fresh rate-limit bucket per request. Falls back to the real socket IP.
    const trustProxy = process.env.TRUST_PROXY !== 'false'
    const socketIp = server?.requestIP(request)?.address ?? 'local'
    const forwarded = trustProxy ? (request.headers.get('x-forwarded-for') ?? '') : ''
    const ip = forwarded.split(',')[0].trim() || socketIp
    const key = `${ip}:${pathname}`
    const hits = (buckets.get(key) ?? []).filter((t) => t > now - WINDOW_MS)

    if (hits.length >= rule.max) {
      set.status = 429
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests — slow down and try again shortly' }
        }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }
      )
    }

    hits.push(now)
    buckets.set(key, hits)
  })
