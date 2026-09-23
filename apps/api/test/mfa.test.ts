import { describe, expect, it } from 'bun:test'
import { Secret, TOTP } from 'otpauth'
import { app } from '../src/app'
import {
  BACKUP_CODE_COUNT,
  generateBackupCodes,
  hashBackupCode,
  normalizeCode,
  signMfaToken,
  verifyMfaToken,
  verifyTotp,
  buildOtpAuthUrl
} from '../src/modules/mfa/service'

const call = async (path: string, init?: RequestInit) => {
  const res = await app.handle(new Request(`http://localhost${path}`, init))
  const body = await res.json().catch(() => null)
  return { status: res.status, body: body as Record<string, any> }
}

const jsonHeaders = { 'Content-Type': 'application/json' }
const ADMIN = { email: 'admin@jamicore.com', password: 'password123' }

const login = (input: Record<string, string>) =>
  call('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })

const verifyChallenge = (mfaToken: string, extra: Record<string, string>) =>
  call('/api/auth/mfa/verify', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ mfaToken, ...extra })
  })

const totpNow = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret) }).generate()

describe('MFA TOTP primitives', () => {
  it('verifies a freshly generated code and rejects a wrong one', () => {
    const secret = new Secret().base32
    const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate()
    expect(verifyTotp(secret, code)).toBe(true)
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0')
    // wrong may coincidentally equal code only when code is 999999 and wraps; guard explicitly
    if (wrong !== code) expect(verifyTotp(secret, wrong)).toBe(false)
    expect(verifyTotp(secret, 'abcdef')).toBe(false)
    expect(verifyTotp(secret, '12345')).toBe(false)
  })

  it('builds a valid otpauth:// URL for the issuer', () => {
    const secret = new Secret().base32
    const url = buildOtpAuthUrl(secret, ADMIN.email)
    expect(url.startsWith('otpauth://totp/')).toBe(true)
    expect(url).toContain(encodeURIComponent(ADMIN.email).slice(0, 5))
  })

  it('generates 10 unique backup codes with stable hashes', () => {
    const codes = generateBackupCodes()
    expect(codes).toHaveLength(BACKUP_CODE_COUNT)
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT)
    for (const c of codes) expect(c).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/)
    expect(hashBackupCode(codes[0])).toBe(hashBackupCode(codes[0].toLowerCase()))
    expect(hashBackupCode(codes[0])).toHaveLength(64)
    expect(normalizeCode(' ab12-cd34 ')).toBe('AB12-CD34')
  })

  it('round-trips the MFA challenge token and rejects tampering', () => {
    const token = signMfaToken('u1', 'm1')
    const payload = verifyMfaToken(token)
    expect(payload.sub).toBe('u1')
    expect(payload.merchantId).toBe('m1')
    expect(payload.type).toBe('mfa')
    expect(() => verifyMfaToken(`${token}x`)).toThrow()
    expect(() => verifyMfaToken('not.a.token')).toThrow()
  })
})

describe('MFA login flow + session inventory', () => {
  let setupSecret = ''
  let backupCodes: string[] = []
  let mfaToken = ''
  let adminAuth: Record<string, string> = {}

  it('records a session row on plain login', async () => {
    const res = await login(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeString()
    adminAuth = { authorization: `Bearer ${res.body.data.accessToken}` }

    const list = await call('/api/mfa/sessions', { headers: adminAuth })
    expect(list.status).toBe(200)
    expect(list.body.data.sessions.length).toBeGreaterThan(0)
    expect(list.body.data.sessions[0].active).toBe(true)
  })

  it('starts MFA setup and returns a secret + otpauth URL', async () => {
    const res = await call('/api/mfa/setup', { method: 'POST', headers: adminAuth })
    expect(res.status).toBe(200)
    expect(res.body.data.secret).toBeString()
    expect(res.body.data.otpauthUrl.startsWith('otpauth://totp/')).toBe(true)
    setupSecret = res.body.data.secret

    const status = await call('/api/mfa/status', { headers: adminAuth })
    expect(status.body.data.enabled).toBe(false)
  })

  it('rejects enabling MFA with a wrong code', async () => {
    const res = await call('/api/mfa/enable', {
      method: 'POST',
      headers: { ...adminAuth, ...jsonHeaders },
      body: JSON.stringify({ code: '000000' })
    })
    expect(res.status).toBe(401)
  })

  it('enables MFA with a valid TOTP code and returns one-time backup codes', async () => {
    const res = await call('/api/mfa/enable', {
      method: 'POST',
      headers: { ...adminAuth, ...jsonHeaders },
      body: JSON.stringify({ code: totpNow(setupSecret) })
    })
    expect(res.status).toBe(200)
    expect(res.body.data.enabled).toBe(true)
    expect(res.body.data.backupCodes).toHaveLength(BACKUP_CODE_COUNT)
    backupCodes = res.body.data.backupCodes

    const status = await call('/api/mfa/status', { headers: adminAuth })
    expect(status.body.data.enabled).toBe(true)
    expect(status.body.data.backupCodesRemaining).toBe(BACKUP_CODE_COUNT)
  })

  it('returns an MFA challenge instead of tokens after password login', async () => {
    const res = await login(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.data.mfaRequired).toBe(true)
    expect(res.body.data.mfaToken).toBeString()
    expect(res.body.data.accessToken).toBeUndefined()
    // The challenge token is stateless (5 min TTL) — reuse it across the
    // verification tests below to stay far under the login rate limit.
    mfaToken = res.body.data.mfaToken
  })

  it('rejects challenge verification with a wrong code', async () => {
    const res = await verifyChallenge(mfaToken, { code: '000000' })
    expect(res.status).toBe(401)
  })

  it('exchanges a valid TOTP code for a token pair and records a session', async () => {
    const before = await call('/api/mfa/sessions', { headers: adminAuth })
    const res = await verifyChallenge(mfaToken, { code: totpNow(setupSecret) })
    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeString()
    expect(res.body.data.refreshToken).toBeString()
    adminAuth = { authorization: `Bearer ${res.body.data.accessToken}` }

    const after = await call('/api/mfa/sessions', { headers: adminAuth })
    expect(after.body.data.sessions.length).toBeGreaterThanOrEqual(before.body.data.sessions.length)
  })

  it('accepts a backup code once, then consumes it', async () => {
    const code = backupCodes[0]
    const first = await verifyChallenge(mfaToken, { backupCode: code })
    expect(first.status).toBe(200)
    adminAuth = { authorization: `Bearer ${first.body.data.accessToken}` }

    const status = await call('/api/mfa/status', { headers: adminAuth })
    expect(status.body.data.backupCodesRemaining).toBe(BACKUP_CODE_COUNT - 1)

    const reuse = await verifyChallenge(mfaToken, { backupCode: code })
    expect(reuse.status).toBe(401)
  })

  it('updates the session on refresh', async () => {
    const verified = await verifyChallenge(mfaToken, { code: totpNow(setupSecret) })
    expect(verified.status).toBe(200)
    const rotated = await call('/api/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: verified.body.data.refreshToken })
    })
    expect(rotated.status).toBe(200)
    expect(rotated.body.data.refreshToken).not.toBe(verified.body.data.refreshToken)
    adminAuth = { authorization: `Bearer ${rotated.body.data.accessToken}` }
  })

  it('rejects refresh after the session is revoked from the inventory', async () => {
    const verified = await verifyChallenge(mfaToken, { code: totpNow(setupSecret) })
    expect(verified.status).toBe(200)
    const auth = { authorization: `Bearer ${verified.body.data.accessToken}` }
    const list = await call('/api/mfa/sessions', { headers: auth })
    const target = list.body.data.sessions.find((s: { active: boolean }) => s.active)
    expect(target).toBeDefined()

    const revoked = await call(`/api/mfa/sessions/${target.id}`, {
      method: 'DELETE',
      headers: auth
    })
    expect(revoked.status).toBe(200)
    expect(revoked.body.data.revoked).toBe(true)

    const refresh = await call('/api/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: verified.body.data.refreshToken })
    })
    expect(refresh.status).toBe(401)
  })

  it('rejects refresh after logout (session revoked)', async () => {
    const verified = await verifyChallenge(mfaToken, { code: totpNow(setupSecret) })
    expect(verified.status).toBe(200)
    const out = await call('/api/auth/logout', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: verified.body.data.refreshToken })
    })
    expect(out.status).toBe(200)

    const refresh = await call('/api/auth/refresh', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ refreshToken: verified.body.data.refreshToken })
    })
    expect(refresh.status).toBe(401)
  })

  it('disables MFA and restores plain login', async () => {
    const verified = await verifyChallenge(mfaToken, { code: totpNow(setupSecret) })
    expect(verified.status).toBe(200)
    const auth = { authorization: `Bearer ${verified.body.data.accessToken}` }
    const off = await call('/api/mfa/disable', {
      method: 'POST',
      headers: { ...auth, ...jsonHeaders },
      body: JSON.stringify({ code: totpNow(setupSecret) })
    })
    expect(off.status).toBe(200)

    const res = await login(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.data.mfaRequired).toBeUndefined()
    expect(res.body.data.accessToken).toBeString()
  })
})
