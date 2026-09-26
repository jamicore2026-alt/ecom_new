/**
 * Growth/platform minor gaps — DB-free unit coverage.
 *
 * Covers the pure logic introduced for: theme validation (hex colors + logo
 * allowlist), audit hash-chain helpers (canonical row + chain hash), weekly
 * analytics bucket labels, per-tenant rate-limit key derivation, and the
 * webhook consumer verification helper. DB-backed paths (version snapshots,
 * rollback, purge, verify endpoint, outbox drain) are exercised by the
 * integration suite where a database is available.
 */
import { describe, expect, test } from 'bun:test'
import { assertHexColor, assertLogoUrl, HEX_COLOR_RE } from '../src/modules/theme/service'
import { AuditService } from '../src/modules/audit-logs/service'
import { bucketFormatFor } from '../src/modules/analytics/service'
import { rateLimitKey, tenantHintFromRequest } from '../src/shared/rate-limit'
import { verifyWebhookSignature } from '../src/shared/webhook-delivery'
import { signWebhookPayload } from '../src/shared/outbound-webhook'

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers })

describe('theme validation', () => {
  test('hex color regex accepts #rrggbb only', () => {
    expect(HEX_COLOR_RE.test('#4f46e5')).toBe(true)
    expect(HEX_COLOR_RE.test('#FFFFFF')).toBe(true)
    expect(HEX_COLOR_RE.test('4f46e5')).toBe(false)
    expect(HEX_COLOR_RE.test('#fff')).toBe(false)
    expect(HEX_COLOR_RE.test('#gggggg')).toBe(false)
    expect(HEX_COLOR_RE.test('#4f46e5ff')).toBe(false)
  })

  test('assertHexColor passes valid colors and undefined, throws otherwise', () => {
    expect(() => assertHexColor('#000000', 'primaryColor')).not.toThrow()
    expect(() => assertHexColor(undefined, 'primaryColor')).not.toThrow()
    expect(() => assertHexColor('red', 'primaryColor')).toThrow()
    expect(() => assertHexColor('#fff', 'accentColor')).toThrow()
  })

  test('logo allowlist accepts http(s), rejects javascript:/data:/ftp', () => {
    expect(() => assertLogoUrl(null)).not.toThrow()
    expect(() => assertLogoUrl('')).not.toThrow()
    expect(() => assertLogoUrl('https://example.com/logo.png')).not.toThrow()
    expect(() => assertLogoUrl('http://localhost:3000/logo.png')).not.toThrow()
    expect(() => assertLogoUrl('javascript:alert(1)')).toThrow()
    expect(() => assertLogoUrl('JAVASCRIPT:alert(1)')).toThrow()
    expect(() => assertLogoUrl('data:image/png;base64,aaa')).toThrow()
    expect(() => assertLogoUrl('ftp://example.com/logo.png')).toThrow()
    expect(() => assertLogoUrl('not-a-url')).toThrow()
  })
})

describe('audit hash chain helpers', () => {
  const row = {
    merchantId: 'm1',
    action: 'settings.theme.update',
    entityType: 'theme',
    entityId: 'm1',
    actorUserId: 'u1',
    metadata: { b: 2, a: 1 },
    createdAt: new Date('2026-09-01T00:00:00.000Z')
  }

  test('canonicalRow is key-order independent', () => {
    const a = AuditService.canonicalRow(row)
    const b = AuditService.canonicalRow({ ...row, metadata: { a: 1, b: 2 } })
    expect(a).toBe(b)
    expect(a).toContain('m1|settings.theme.update|theme|m1|u1|')
  })

  test('chainHash is sha256(prev|canonical), 64 hex chars, chained', () => {
    const canonical = AuditService.canonicalRow(row)
    const h1 = AuditService.chainHash(null, canonical)
    const h2 = AuditService.chainHash(h1, canonical)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h2).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).not.toBe(h2)
    // Genesis (null prev) differs from empty-string prev only by the join —
    // both are deterministic.
    expect(AuditService.chainHash(null, canonical)).toBe(h1)
  })
})

describe('analytics week labels', () => {
  test('week grain gets an honest "Week of" format, day/month unchanged', () => {
    expect(bucketFormatFor('week')).toBe('"Week of "YYYY-MM-DD')
    expect(bucketFormatFor('day')).toBe('YYYY-MM-DD')
    expect(bucketFormatFor('month')).toBe('YYYY-MM')
  })
})

describe('per-tenant rate limit keys', () => {
  test('x-merchant-id header wins as tenant hint', () => {
    expect(tenantHintFromRequest(req('http://localhost/api/content', { 'x-merchant-id': 'm_123' }))).toBe('t:m_123')
    expect(tenantHintFromRequest(req('http://localhost/api/content', { 'x-tenant-id': 't-9' }))).toBe('t:t-9')
  })

  test('subdomain-per-tenant host yields a hint; bare hosts do not', () => {
    expect(tenantHintFromRequest(req('https://acme.example.com/api/content'))).toBe('t:acme')
    expect(tenantHintFromRequest(req('http://localhost:3000/api/content'))).toBeNull()
    expect(tenantHintFromRequest(req('https://example.com/api/content'))).toBeNull()
  })

  test('JWT merchantId claim is used as a hint (label only, never auth)', () => {
    const payload = Buffer.from(JSON.stringify({ merchantId: 'm_jwt1' })).toString('base64url')
    const token = `aaa.${payload}.bbb`
    expect(
      tenantHintFromRequest(req('http://localhost/api/content', { authorization: `Bearer ${token}` }))
    ).toBe('t:m_jwt1')
  })

  test('no hint → null (IP-only bucket, unchanged anonymous behaviour)', () => {
    expect(tenantHintFromRequest(req('http://localhost/api/content'))).toBeNull()
  })

  test('rateLimitKey isolates tenants sharing one IP', () => {
    const a = rateLimitKey('1.2.3.4', 't:shop-a', '/api/content')
    const b = rateLimitKey('1.2.3.4', 't:shop-b', '/api/content')
    const anon = rateLimitKey('1.2.3.4', null, '/api/content')
    expect(a).not.toBe(b)
    expect(a).toContain('shop-a')
    expect(anon).toBe('1.2.3.4:/api/content')
  })
})

describe('webhook consumer verification', () => {
  test('sign + verify round-trips; wrong secret and tampered payload fail', () => {
    const payload = { orderId: 'o1', total: 99.5 }
    const ts = Date.now()
    const sig = signWebhookPayload(payload, 's3cret', ts)
    expect(verifyWebhookSignature(payload, ts, sig, ['s3cret'])).toBe(true)
    // Dual-secret overlap: previous secret still verifies during rotation.
    expect(verifyWebhookSignature(payload, ts, sig, ['new-secret', 's3cret'])).toBe(true)
    expect(verifyWebhookSignature(payload, ts, sig, ['wrong'])).toBe(false)
    expect(verifyWebhookSignature({ ...payload, total: 1 }, ts, sig, ['s3cret'])).toBe(false)
    expect(verifyWebhookSignature(payload, ts + 1, sig, ['s3cret'])).toBe(false)
  })
})
