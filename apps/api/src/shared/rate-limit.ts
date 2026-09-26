import type { Elysia } from 'elysia'
import { createConnection } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

interface Rule {
  test: (pathname: string, method: string) => boolean
  max: number
}

export interface CounterStore {
  get(key: string): Promise<number>
  incrementAndCheck(key: string, windowMs: number, max: number): Promise<{ allowed: boolean; count: number }>
  reset(key: string): Promise<void>
  close?(): Promise<void>
}

const WINDOW_MS = 60_000

/**
 * Per-tenant rate limiting.
 *
 * The global `rateLimiter` hook runs in `onRequest`, i.e. BEFORE auth, so the
 * merchant id is not yet resolved there. To still isolate tenants from each
 * other (one merchant's burst must not eat another's budget, and one bad
 * actor must not lock out a whole NAT'd IP), the bucket key carries a
 * best-effort tenant hint in addition to the client IP:
 *
 *   1. `x-merchant-id` / `x-tenant-id` header when the caller supplies it
 *      (first-party dashboard / mobile clients);
 *   2. leftmost DNS label of the Host (subdomain-per-tenant storefronts,
 *      e.g. `acme.example.com` → `acme`);
 *   3. `merchantId` / `merchant_id` / `mid` claim of an unverified JWT payload
 *      decode (Bearer token present but not yet verified — used ONLY as a
 *      bucket label, never as authentication);
 *   4. fallback: IP-only bucket (unchanged behaviour for anonymous traffic).
 *
 * Authenticated routes additionally get a SECOND, exact tenant bucket via
 * `tenantRateLimiter` (registered after auth, where `auth.merchant.id` is
 * known). Both buckets must allow the request.
 *
 * Sensitive routes (auth, password reset, checkout/pay, coupon validate)
 * carry lower per-tenant budgets so credential-stuffing / card-testing
 * against one merchant cannot hide inside global IP headroom.
 */
export const tenantHintFromRequest = (request: Request): string | null => {
  const headerTenant =
    request.headers.get('x-merchant-id')?.trim() || request.headers.get('x-tenant-id')?.trim() || null
  if (headerTenant && /^[A-Za-z0-9_-]{1,64}$/.test(headerTenant)) return `t:${headerTenant}`

  try {
    const host = new URL(request.url).hostname
    const parts = host.split('.')
    // Subdomain-per-tenant: `acme.example.com` → tenant `acme`. Bare hosts
    // (`localhost`, IPs, apex domains) yield no hint.
    if (parts.length >= 3 && parts[0] && parts[0] !== 'www' && /^[a-z0-9-]{1,63}$/i.test(parts[0])) {
      return `t:${parts[0].toLowerCase()}`
    }
  } catch {
    /* ignore malformed URL — fall through to JWT sniffing */
  }

  const auth = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/.exec(auth)
  if (match) {
    try {
      const payload = JSON.parse(
        Buffer.from(match[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
      ) as Record<string, unknown>
      const mid = payload.merchantId ?? payload.merchant_id ?? payload.mid
      if (typeof mid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(mid)) return `t:${mid}`
    } catch {
      /* unverifiable payload — ignore, IP-only bucket applies */
    }
  }
  return null
}

/** Build the onRequest bucket key: IP + tenant hint + pathname. */
export const rateLimitKey = (ip: string, tenantHint: string | null, pathname: string): string =>
  tenantHint ? `${ip}:${tenantHint}:${pathname}` : `${ip}:${pathname}`

const RULES: Rule[] = [
  { test: (p) => p === '/api/platform/auth/login', max: 10 },
  { test: (p) => p.startsWith('/api/platform'), max: 120 },
  { test: (p) => p === '/api/auth/login', max: 10 },
  { test: (p) => p === '/api/auth/refresh' || p === '/api/auth/logout', max: 60 },
  { test: (p) => /^\/api\/store\/[^/]+\/auth\/(register|login|password)$/.test(p), max: 10 },
  { test: (p) => /^\/api\/store\/[^/]+\/auth\/(forgot-password|reset-password|resend-verification|verify-email)/.test(p), max: 10 },
  { test: (p) => p.startsWith('/api/auth'), max: 30 },
  // Sensitive per-tenant routes: tight budgets so abuse against one merchant
  // (coupon brute-forcing, refund farming, secret rotation churn, password
  // changes) cannot hide inside the global mutating-write budget below.
  { test: (p) => p === '/api/coupons/validate', max: 60 },
  { test: (p) => p.includes('/password') || p.includes('/mfa/'), max: 20 },
  { test: (p) => p.includes('/refunds') || p.includes('/returns'), max: 120 },
  { test: (p) => p.includes('/rotate') || p.includes('/rotate-secret'), max: 20 },
  { test: (p) => p.includes('/webhook-endpoints') || p.includes('/webhook-deliveries'), max: 120 },  { test: (p, m) => m === 'GET' && /^\/api\/store\/[^/]+\/orders\/[^/]+$/.test(p), max: 10 },
  { test: (p) => p.endsWith('/checkout') || p.endsWith('/checkout/pay') || p.endsWith('/checkout/preview'), max: 30 },
  { test: (p) => p.endsWith('/orders') && p.includes('/checkout'), max: 30 },
  { test: (p) => p.endsWith('/sync'), max: 30 },
  { test: (p) => p.endsWith('/events'), max: 60 },
  { test: (p) => p.startsWith('/api/webhooks/'), max: 240 },
  { test: (p, m) => m === 'GET' && /^\/api\/store\/[^/]+\/(products|categories|search)/.test(p), max: 60 },
  // Default-deny: every other mutating API call gets a baseline budget so no
  // write endpoint is unlimited. Must stay LAST — first match wins.
  { test: (p, m) => p.startsWith('/api/') && (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'), max: 600 }
]

class MemoryCounterStore implements CounterStore {
  private buckets = new Map<string, { windowStart: number; count: number }>()
  private lastSweep = Date.now()

  private sweep() {
    const now = Date.now()
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= 15 * 60_000) this.buckets.delete(key)
    }
    this.lastSweep = now
  }

  async get(key: string) {
    const bucket = this.buckets.get(key)
    if (!bucket) return 0
    if (Date.now() - bucket.windowStart >= 15 * 60_000) {
      this.buckets.delete(key)
      return 0
    }
    return bucket.count
  }

  async incrementAndCheck(key: string, windowMs: number, max: number) {
    const now = Date.now()
    if (now - this.lastSweep > windowMs) this.sweep()

    let bucket = this.buckets.get(key)
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { windowStart: now, count: 0 }
      this.buckets.set(key, bucket)
    }
    bucket.count += 1
    return { allowed: bucket.count <= max, count: bucket.count }
  }

  async reset(key: string) {
    this.buckets.delete(key)
  }
}

// Minimal Redis RESP client so the API does not need a second Redis-specific
// dependency. It uses one shared connection for both rate limiting and login lockouts.
class RedisCounterStore implements CounterStore {
  private socket: any
  private buffer = Buffer.alloc(0)
  private pending: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = []
  private connecting?: Promise<void>
  private closed = false
  private readonly host: string
  private readonly port: number
  private readonly tls: boolean
  private readonly username?: string
  private readonly password?: string
  private readonly database?: string

  constructor(url: string) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('REDIS_URL must be a valid URL using redis:// or rediss:// — e.g. redis://user:pass@host:6379/0')
    }
    if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
      throw new Error(
        `REDIS_URL must use redis:// or rediss:// (got scheme "${parsed.protocol.replace(/:$/, '')}"). ` +
          'Example: redis://user:pass@host:6379/0'
      )
    }
    this.host = parsed.hostname
    this.port = Number(parsed.port || 6379)
    this.tls = parsed.protocol === 'rediss:'
    this.username = parsed.username ? decodeURIComponent(parsed.username) : undefined
    this.password = parsed.password ? decodeURIComponent(parsed.password) : undefined
    this.database = parsed.pathname.length > 1 ? parsed.pathname.slice(1) : undefined
  }

  private encode(parts: Array<string | number>) {
    return Buffer.from(`*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(String(part))}\r\n${part}\r\n`).join('')}`)
  }

  private parse(): { done: boolean; value?: unknown } {
    const end = (offset: number) => this.buffer.indexOf('\r\n', offset)
    if (this.buffer.length === 0) return { done: false }
    const type = this.buffer[0]
    const lineEnd = end(1)
    if (lineEnd < 0) return { done: false }
    const line = this.buffer.subarray(1, lineEnd).toString()
    let consumed = 0
    let value: unknown
    if (type === 43) value = line
    else if (type === 45) value = new Error(line)
    else if (type === 58) value = Number(line)
    else if (type === 36) {
      const length = Number(line)
      if (length === -1) consumed = lineEnd + 2
      else {
        const total = lineEnd + 2 + length + 2
        if (this.buffer.length < total) return { done: false }
        value = this.buffer.subarray(lineEnd + 2, lineEnd + 2 + length).toString()
        consumed = total
      }
    } else return { done: false }
    if (consumed === 0) consumed = lineEnd + 2
    this.buffer = this.buffer.subarray(consumed)
    return { done: true, value }
  }

  private onData = (data: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(data)])
    while (this.pending.length) {
      const parsed = this.parse()
      if (!parsed.done) break
      const pending = this.pending.shift()!
      if (parsed.value instanceof Error) pending.reject(parsed.value)
      else pending.resolve(parsed.value)
    }
  }

  private onClose = () => {
    this.socket = undefined
    const error = new Error('Redis connection closed')
    for (const pending of this.pending.splice(0)) pending.reject(error)
    if (!this.closed) this.connecting = undefined
  }

  private async connect() {
    if (this.socket && !this.connecting) return
    if (this.connecting) return this.connecting

    this.connecting = (async () => {
      const socket = this.tls
        ? tlsConnect({ host: this.host, port: this.port, servername: this.host })
        : createConnection({ host: this.host, port: this.port })

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.destroy()
          reject(new Error(`Unable to connect to Redis at ${this.host}:${this.port}`))
        }, 5_000)
        const event = this.tls ? 'secureConnect' : 'connect'
        socket.once(event, () => {
          clearTimeout(timeout)
          this.socket = socket
          socket.on('data', this.onData)
          socket.on('close', this.onClose)
          socket.on('error', this.onClose)
          resolve()
        })
        socket.once('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
      })

      if (this.username) await this.rawCommand(['AUTH', this.username, this.password ?? ''])
      else if (this.password) await this.rawCommand(['AUTH', this.password])
      if (this.database) await this.rawCommand(['SELECT', this.database])
    })().finally(() => {
      this.connecting = undefined
    })

    await this.connecting
  }

  private async rawCommand(parts: Array<string | number>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.socket.write(this.encode(parts))
    })
  }

  private async command(parts: Array<string | number>): Promise<unknown> {
    await this.connect()
    return this.rawCommand(parts)
  }

  async get(key: string) {
    const value = await this.command(['GET', key])
    return value == null ? 0 : Number(value)
  }

  async incrementAndCheck(key: string, windowMs: number, max: number) {
    const script = 'local c=redis.call("INCR",KEYS[1]); if c==1 then redis.call("PEXPIRE",KEYS[1],ARGV[1]); end; return c'
    const count = Number(await this.command(['EVAL', script, 1, key, windowMs]))
    return { allowed: count <= max, count }
  }

  async reset(key: string) {
    await this.command(['DEL', key])
  }

  async close() {
    this.closed = true
    this.socket?.destroy()
    this.socket = undefined
  }
}

let store: CounterStore | undefined

export const getRateLimitStore = (): CounterStore => {
  if (!store) {
    const explicit = (process.env.RATE_LIMIT_STORE ?? '').toLowerCase()
    const production = process.env.NODE_ENV === 'production'
    const allowMemory = process.env.RATE_LIMIT_ALLOW_MEMORY === 'true'

    if (production && explicit === 'memory' && !allowMemory) {
      throw new Error('RATE_LIMIT_STORE=memory is not allowed in production without RATE_LIMIT_ALLOW_MEMORY=true')
    }

    const useRedis = production || explicit === 'redis' || (explicit !== 'memory' && Boolean(process.env.REDIS_URL))

    if (useRedis) {
      const url = process.env.REDIS_URL
      if (!url) throw new Error('REDIS_URL must be set for production/shared rate limiting — e.g. redis://user:pass@host:6379/0')
      store = new RedisCounterStore(url)
    } else {
      store = new MemoryCounterStore()
    }
  }
  return store
}

const fallbackToMemory = (reason: string, err?: unknown) => {
  store = new MemoryCounterStore()
  // Structured logging not imported here to avoid circular deps — use raw console for startup fallback
  console.warn(`[rate-limit] ${reason}; falling back to in-memory store.`, err ?? '')
}

// Validate Redis before listening — but never crash the API just because Redis
// is unreachable/absent. Degrade to the in-memory store (single-node behaviour)
// with a warning so a transient/absent Redis cannot take the API down.
export const initializeRateLimitStore = async () => {
  const selected = getRateLimitStore()
  if (!(selected instanceof RedisCounterStore)) return
  try {
    await selected.get('__jamicore_rate_limit_startup_check__')
    await selected.reset('__jamicore_rate_limit_startup_check__')
  } catch (err) {
    if (process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_ALLOW_MEMORY !== 'true') {
      throw new Error(`Redis is required for production rate limiting: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
    }
    fallbackToMemory('Redis unreachable at startup', err)
  }
}

export const closeRateLimitStore = async () => {
  await store?.close?.()
}

/**
 * Exact per-tenant limiter for authenticated routes. Register AFTER auth so
 * `auth.merchant.id` is known — the bucket is `tenant:<merchantId>:<path>`,
 * independent of IP, so one merchant's burst never affects another even when
 * the pre-auth hint was absent. `max` should mirror (or tighten) the matching
 * RULES entry for the route.
 */
export const tenantRateLimiter = (opts: { max: number; windowMs?: number }) => (app: Elysia) =>
  app.onBeforeHandle(async ({ auth, request, set }: any) => {
    if (process.env.NODE_ENV === 'test') return
    const merchantId: string | undefined = auth?.merchant?.id
    if (!merchantId) return
    const { pathname } = new URL(request.url)
    const key = `tenant:${merchantId}:${pathname}`
    const result = await getRateLimitStore().incrementAndCheck(key, opts.windowMs ?? WINDOW_MS, opts.max)
    if (!result.allowed) {
      set.status = 429
      return {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests for this store — slow down and try again shortly' }
      }
    }
  })

export const rateLimiter = (app: Elysia) =>
  app.onRequest(async ({ request, server, set }) => {
    if (process.env.NODE_ENV === 'test') return

    const { pathname } = new URL(request.url)
    const method = request.method
    const rule = RULES.find((r) => r.test(pathname, method))
    if (!rule) return

    // x-forwarded-for handling intentionally unchanged.
    const trustProxy = process.env.TRUST_PROXY !== 'false'
    const socketIp = server?.requestIP(request)?.address ?? 'local'
    const forwarded = trustProxy ? (request.headers.get('x-forwarded-for') ?? '') : ''
    const ip = forwarded.split(',')[0].trim() || socketIp
    // Per-tenant bucket: the same IP hitting two different merchants consumes
    // two independent budgets (see tenantHintFromRequest docs above).
    const key = rateLimitKey(ip, tenantHintFromRequest(request), pathname)
    const result = await getRateLimitStore().incrementAndCheck(key, WINDOW_MS, rule.max)

    if (!result.allowed) {
      set.status = 429
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests — slow down and try again shortly' }
        }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }
      )
    }
  })
