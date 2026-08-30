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

const RULES: Rule[] = [
  { test: (p) => p === '/api/auth/login', max: 10 },
  { test: (p) => p === '/api/auth/refresh' || p === '/api/auth/logout', max: 60 },
  { test: (p) => /^\/api\/store\/[^/]+\/auth\/(register|login|password)$/.test(p), max: 10 },
  { test: (p) => /^\/api\/store\/[^/]+\/auth\/(forgot-password|reset-password|resend-verification|verify-email)/.test(p), max: 10 },
  { test: (p) => p.startsWith('/api/auth'), max: 30 },
  { test: (p, m) => m === 'GET' && /^\/api\/store\/[^/]+\/orders\/[^/]+$/.test(p), max: 10 },
  { test: (p) => p.endsWith('/checkout') || p.endsWith('/checkout/pay') || p.endsWith('/checkout/preview'), max: 30 },
  { test: (p) => p.endsWith('/orders') && p.includes('/checkout'), max: 30 },
  { test: (p) => p.endsWith('/sync'), max: 30 },
  { test: (p) => p.endsWith('/events'), max: 60 },
  { test: (p) => p.startsWith('/api/webhooks/'), max: 240 }
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
    const key = `${ip}:${pathname}`
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
