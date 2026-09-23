import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Secret, TOTP } from 'otpauth'
import { db } from '../../database/client'
import { sessions, tokenBlacklist, users } from '../../database/schema'
import { REFRESH_SECRET, hashToken } from '../../plugins/auth'
import { badRequest, unauthorized } from '../../shared/errors'
import { ok } from '../../shared/response'

export const MFA_ISSUER = 'JamiCore'
export const MFA_TOKEN_TTL_SECONDS = 5 * 60
export const BACKUP_CODE_COUNT = 10
export const TOTP_WINDOW = 1

const b64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64')

/** SHA-256 hex digest (backup codes + session jti hashes). Matches hashToken output. */
export const sha256Hex = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex')

const safeEqualHex = (a: string, b: string) => {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export interface MfaTokenPayload {
  type: 'mfa'
  sub: string
  merchantId: string
  iat: number
  exp: number
}

/** Short-lived challenge token proving the password step passed. Signed HS256
 *  with the refresh secret; stateless so no new table is needed. */
export const signMfaToken = (userId: string, merchantId: string): string => {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8'))
  const payload: MfaTokenPayload = {
    type: 'mfa',
    sub: userId,
    merchantId,
    iat: now,
    exp: now + MFA_TOKEN_TTL_SECONDS
  }
  const body = `${header}.${b64url(Buffer.from(JSON.stringify(payload), 'utf8'))}`
  const sig = b64url(createHmac('sha256', REFRESH_SECRET).update(body).digest())
  return `${body}.${sig}`
}

export const verifyMfaToken = (token: string): MfaTokenPayload => {
  const parts = token.split('.')
  if (parts.length !== 3) throw unauthorized('Invalid or expired verification code')
  const [header, payloadB64, sig] = parts
  const expected = b64url(createHmac('sha256', REFRESH_SECRET).update(`${header}.${payloadB64}`).digest())
  if (!safeEqualHex(sig, expected)) throw unauthorized('Invalid or expired verification code')
  let payload: MfaTokenPayload
  try {
    payload = JSON.parse(unb64url(payloadB64).toString('utf8')) as MfaTokenPayload
  } catch {
    throw unauthorized('Invalid or expired verification code')
  }
  if (payload.type !== 'mfa' || !payload.sub || payload.exp * 1000 < Date.now()) {
    throw unauthorized('Invalid or expired verification code')
  }
  return payload
}

export const buildOtpAuthUrl = (secretBase32: string, email: string): string =>
  new TOTP({
    issuer: MFA_ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32)
  }).toString()

/** Verify a 6-digit TOTP code with a ±1 step window for clock skew. */
export const verifyTotp = (secretBase32: string, code: string): boolean => {
  const token = code.trim()
  if (!/^\d{6}$/.test(token)) return false
  let secret: Secret
  try {
    secret = Secret.fromBase32(secretBase32)
  } catch {
    return false
  }
  return TOTP.validate({ token, secret, window: TOTP_WINDOW }) !== null
}

export const generateBackupCodes = (count = BACKUP_CODE_COUNT): string[] => {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const hex = randomBytes(4).toString('hex').toUpperCase()
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`)
  }
  return codes
}

export const hashBackupCode = (code: string): string =>
  sha256Hex(code.trim().toUpperCase())

const normalizeBackupCode = (code: string) => code.trim().toUpperCase()

export class MfaService {
  static async status(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw unauthorized('User no longer exists')
    return ok({ enabled: user.mfaEnabled, backupCodesRemaining: user.mfaBackupCodes.length })
  }

  /** Start enrollment: generate a secret and stash it (disabled until confirmed). */
  static async startSetup(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw unauthorized('User no longer exists')
    if (user.mfaEnabled) throw badRequest('MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled')
    const secret = new Secret().base32
    await db.update(users).set({ mfaSecret: secret }).where(eq(users.id, userId))
    return ok({ secret, otpauthUrl: buildOtpAuthUrl(secret, user.email) })
  }

  /** Confirm enrollment with a TOTP code; returns single-use backup codes (shown once). */
  static async confirmSetup(userId: string, code: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw unauthorized('User no longer exists')
    if (user.mfaEnabled) throw badRequest('MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled')
    if (!user.mfaSecret || !verifyTotp(user.mfaSecret, code)) {
      throw unauthorized('Invalid verification code')
    }
    const backupCodes = generateBackupCodes()
    await db
      .update(users)
      .set({ mfaEnabled: true, mfaBackupCodes: backupCodes.map(hashBackupCode) })
      .where(eq(users.id, userId))
    return ok({ enabled: true, backupCodes })
  }

  static async disable(userId: string, code: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw unauthorized('User no longer exists')
    if (!user.mfaEnabled) return ok({ enabled: false })
    const valid = user.mfaSecret && verifyTotp(user.mfaSecret, code)
    if (!valid) throw unauthorized('Invalid verification code')
    await db
      .update(users)
      .set({ mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] })
      .where(eq(users.id, userId))
    return ok({ enabled: false })
  }

  static async regenerateBackupCodes(userId: string, code: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw unauthorized('User no longer exists')
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw badRequest('MFA_NOT_ENABLED', 'Two-factor authentication is not enabled')
    }
    if (!verifyTotp(user.mfaSecret, code)) throw unauthorized('Invalid verification code')
    const backupCodes = generateBackupCodes()
    await db
      .update(users)
      .set({ mfaBackupCodes: backupCodes.map(hashBackupCode) })
      .where(eq(users.id, userId))
    return ok({ backupCodes })
  }

  /**
   * Verify a login challenge step. Accepts either a TOTP `code` or a single-use
   * `backupCode`. Consumes the backup code hash on success so it cannot be reused.
   */
  static async verifyLoginChallenge(userId: string, input: { code?: string; backupCode?: string }) {
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw unauthorized('User no longer exists')
    if (!user.mfaEnabled) return ok({ user, usedBackupCode: false })

    if (input.code) {
      if (user.mfaSecret && verifyTotp(user.mfaSecret, input.code)) {
        return ok({ user, usedBackupCode: false })
      }
      throw unauthorized('Invalid verification code')
    }

    if (input.backupCode) {
      const hash = hashBackupCode(input.backupCode)
      const idx = user.mfaBackupCodes.findIndex((h) => safeEqualHex(h, hash))
      if (idx === -1) throw unauthorized('Invalid backup code')
      const remaining = user.mfaBackupCodes.filter((_, i) => i !== idx)
      await db.update(users).set({ mfaBackupCodes: remaining }).where(eq(users.id, userId))
      const [fresh] = await db.select().from(users).where(eq(users.id, userId))
      return ok({ user: fresh ?? user, usedBackupCode: true })
    }

    throw badRequest('MFA_CODE_REQUIRED', 'Provide a verification code or a backup code')
  }

  static async listSessions(userId: string, merchantId: string) {
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.merchantId, merchantId)))
      .orderBy(desc(sessions.createdAt))
    return ok({
      sessions: rows.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        createdAt: s.createdAt,
        active: !s.revokedAt && s.expiresAt.getTime() > Date.now(),
        current: false
      }))
    })
  }

  static async revokeSession(userId: string, merchantId: string, sessionId: string, currentJtiHash?: string) {
    const [row] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, userId),
          eq(sessions.merchantId, merchantId),
          isNull(sessions.revokedAt)
        )
      )
    if (!row) throw badRequest('SESSION_NOT_FOUND', 'Session not found or already revoked')
    await revokeSessionRow(row.jtiHash, row.expiresAt, row.userId)
    const current = currentJtiHash ? safeEqualHex(row.jtiHash, currentJtiHash) : false
    return ok({ revoked: true, current })
  }
}

export interface SessionRecord {
  merchantId: string
  userId: string
  jti: string
  ip: string | null
  userAgent: string | null
  expiresAt: Date
}

/** Insert a login session row. jtiHash = sha256(refresh jti); raw tokens are never stored. */
export const recordSession = async (input: SessionRecord) => {
  const jtiHash = hashToken(input.jti)
  await db
    .insert(sessions)
    .values({
      merchantId: input.merchantId,
      userId: input.userId,
      jtiHash,
      ip: input.ip?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      expiresAt: input.expiresAt
    })
    .onConflictDoNothing({ target: sessions.jtiHash })
  return jtiHash
}

/** Refresh must reject revoked or expired sessions before rotating tokens. */
export const assertSessionUsable = async (jti: string) => {
  const jtiHash = hashToken(jti)
  const [row] = await db.select().from(sessions).where(eq(sessions.jtiHash, jtiHash))
  if (!row) return { row: null, jtiHash }
  if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Session has been revoked')
  }
  return { row, jtiHash }
}

export const touchSession = async (jtiHash: string) => {
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.jtiHash, jtiHash))
}

/** Mark a session revoked and blacklist its jti so paired access tokens stop working. */
export const revokeSessionRow = async (jtiHash: string, expiresAt: Date, userId: string) => {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.jtiHash, jtiHash))
  await db
    .insert(tokenBlacklist)
    .values({ userId, jti: jtiHash, expiresAt })
    .onConflictDoNothing({ target: tokenBlacklist.jti })
}

/** Normalize a backup code for constant-time comparison in tests and service code. */
export const normalizeCode = normalizeBackupCode
