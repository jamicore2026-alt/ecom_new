import { and, count, desc, eq, ilike } from 'drizzle-orm'
import { compare, hash, hashSync } from 'bcryptjs'
import { randomBytes, randomUUID } from 'node:crypto'
import { db } from '../../database/client'
import { merchantModules, merchants, outlets, platformAdmins, platformTokenBlacklist, roles, users } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound, unauthorized } from '../../shared/errors'
import { buildOtpAuthUrl, generateBackupCodes, sha256Hex, verifyTotp } from '../mfa/service'
import { DEFAULT_MODULES, DEFAULT_ROLES, MODULES, type ModuleId } from '../../shared/types'
import { makeMeta, parsePagination } from '../../shared/pagination'
import {
  assertTransition,
  IllegalMerchantTransition,
  nextStatuses,
  type MerchantStatus
} from '../../shared/merchant-lifecycle'
import { AuditService } from '../audit-logs/service'
import { loginAttempts } from '../auth/login-attempts'
import { validatePassword } from '../../shared/password'

/** Burn a bcrypt round for unknown emails so timing doesn't leak account existence. */
const DUMMY_HASH = hashSync('timing-equalizer', 10)
const alwaysCompare = async (password: string) => {
  await compare(password, DUMMY_HASH)
}

/** Namespace platform buckets away from merchant login-attempt keys. */
const attemptKey = (email: string) => `platform:${email}`

export interface PlatformActor {
  id: string
  email: string
}

/**
 * Cross-tenant by design — platform operations are the one place where the
 * plain admin `db` singleton is correct, not a bug. Never route these through
 * `createTenantConnection`: there is no single tenant to scope them to.
 */
export class PlatformService {
  static async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase()

    // Account-level lockout mirrors merchant login (5 fails / 15 min).
    // Keys are namespaced so merchant and platform buckets never collide.
    // NOTE: login attempts are not written to audit_logs — rows require a
    // merchant FK and a platform login has no attributable merchant (same
    // rationale as merchant unknown-email skips).
    if (await loginAttempts.get(attemptKey(normalized))) {
      await alwaysCompare(password)
      throw unauthorized('Invalid email or password')
    }

    const [admin] = await db
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.email, normalized))

    const matches = admin
      ? await compare(password, admin.passwordHash)
      : await alwaysCompare(password).then(() => false)
    if (!admin || !matches) {
      await loginAttempts.increment(attemptKey(normalized))
      throw unauthorized('Invalid email or password')
    }
    if (admin.status !== 'active') {
      await alwaysCompare(password)
      throw unauthorized('Invalid email or password')
    }
    await loginAttempts.reset(attemptKey(normalized))
    await db
      .update(platformAdmins)
      .set({ lastLoginAt: new Date() })
      .where(eq(platformAdmins.id, admin.id))

    return { id: admin.id, email: admin.email, tokenVersion: admin.tokenVersion }
  }

  /** Row validation for platformAuth: null when deleted, status gates access. */
  static async getAdminForAuth(id: string) {
    const [admin] = await db
      .select({ id: platformAdmins.id, email: platformAdmins.email, status: platformAdmins.status, tokenVersion: platformAdmins.tokenVersion })
      .from(platformAdmins)
      .where(eq(platformAdmins.id, id))
    if (!admin || admin.status !== 'active') return null
    return admin
  }

  /** Blacklist a platform JWT by jti (logout / disable / password change). */
  static async revokeToken(jti: string, adminId: string, ttlSeconds = 3600) {    await db
      .insert(platformTokenBlacklist)
      .values({ jti, adminId, expiresAt: new Date(Date.now() + ttlSeconds * 1000) })
      .onConflictDoNothing()
  }

  static async isRevoked(jti: string) {
    const [row] = await db
      .select({ jti: platformTokenBlacklist.jti })
      .from(platformTokenBlacklist)
      .where(eq(platformTokenBlacklist.jti, jti))
    return !!row
  }

  static async listAdmins() {
    const rows = await db
      .select({
        id: platformAdmins.id,
        email: platformAdmins.email,
        status: platformAdmins.status,
        lastLoginAt: platformAdmins.lastLoginAt,
        mfaEnabled: platformAdmins.mfaEnabled,
        createdAt: platformAdmins.createdAt
      })
      .from(platformAdmins)
      .orderBy(platformAdmins.createdAt)
    return ok(rows)
  }

  static async createAdmin(input: { email: string; password: string }, actor: PlatformActor) {
    const email = input.email.trim().toLowerCase()
    validatePassword(input.password)
    const [existing] = await db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, email))
    if (existing) throw conflict('ADMIN_EXISTS', 'A platform admin with this email already exists')
    const [row] = await db
      .insert(platformAdmins)
      .values({ email, passwordHash: await hash(input.password, 12) })
      .returning({ id: platformAdmins.id, email: platformAdmins.email })
    // NOTE: not written to audit_logs — rows require a merchant FK and admin
    // lifecycle has no attributable merchant. Creation is visible via the
    // returned row; consider a platform-scoped audit trail as follow-up.
    return ok(row)
  }

  static async setAdminStatus(id: string, status: 'active' | 'disabled', actor: PlatformActor) {
    if (id === actor.id) throw badRequest('SELF_CHANGE_FORBIDDEN', 'You cannot change your own status')
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, id))
    if (!admin) throw notFound('ADMIN_NOT_FOUND', 'Platform admin not found')
    if (status === 'disabled') {
      const actives = await db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.status, 'active'))
      if (actives.length <= 1 && actives[0]?.id === id) {
        throw badRequest('LAST_ADMIN', 'Cannot disable the last active platform admin')
      }
    }
    const [updated] = await db
      .update(platformAdmins)
      .set({ status, tokenVersion: admin.tokenVersion + 1 })
      .where(eq(platformAdmins.id, id))
      .returning({ id: platformAdmins.id, email: platformAdmins.email, status: platformAdmins.status })
    return ok(updated)
  }

  static async changeOwnPassword(adminId: string, oldPassword: string, newPassword: string) {
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, adminId))
    if (!admin || admin.status !== 'active') throw unauthorized('Invalid session')
    if (!(await compare(oldPassword, admin.passwordHash))) throw unauthorized('Current password is incorrect')
    validatePassword(newPassword)
    await db
      .update(platformAdmins)
      .set({ passwordHash: await hash(newPassword, 12), tokenVersion: admin.tokenVersion + 1 })
      .where(eq(platformAdmins.id, adminId))
    return ok({ changed: true })
  }

  static async revokeAllSessions(adminId: string, actor: PlatformActor) {
    if (adminId === actor.id) throw badRequest('SELF_CHANGE_FORBIDDEN', 'Use sign-out for your own sessions')
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, adminId))
    if (!admin) throw notFound('ADMIN_NOT_FOUND', 'Platform admin not found')
    await db
      .update(platformAdmins)
      .set({ tokenVersion: admin.tokenVersion + 1 })
      .where(eq(platformAdmins.id, adminId))
    return ok({ revoked: true })
  }

  // ------------------------- opt-in TOTP MFA -------------------------

  static async mfaStatus(adminId: string) {
    const [admin] = await db
      .select({ mfaEnabled: platformAdmins.mfaEnabled, mfaBackupCodes: platformAdmins.mfaBackupCodes })
      .from(platformAdmins)
      .where(eq(platformAdmins.id, adminId))
    if (!admin) throw unauthorized('Invalid session')
    return ok({ enabled: admin.mfaEnabled, backupCodesRemaining: (admin.mfaBackupCodes ?? []).length })
  }

  /** Start enrollment: fresh secret (unverified), otpauth URL for the app. */
  static async mfaSetup(adminId: string, email: string) {
    const { Secret } = await import('otpauth')
    const base32 = Secret.fromHex(randomBytes(20).toString('hex')).base32
    await db
      .update(platformAdmins)
      .set({ mfaSecret: base32, mfaEnabled: false })
      .where(eq(platformAdmins.id, adminId))
    return ok({ otpauthUrl: buildOtpAuthUrl(base32, email), secret: base32 })
  }

  /** Verify a TOTP code against the pending secret and enable MFA. */
  static async mfaEnable(adminId: string, code: string) {
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, adminId))
    if (!admin?.mfaSecret) throw badRequest('MFA_NOT_STARTED', 'Start MFA setup first')
    if (!verifyTotp(admin.mfaSecret, code)) throw unauthorized('Invalid verification code')
    const codes = generateBackupCodes()
    await db
      .update(platformAdmins)
      .set({
        mfaEnabled: true,
        mfaBackupCodes: codes.map((c) => sha256Hex(c.replace('-', '')))
      })
      .where(eq(platformAdmins.id, adminId))
    return ok({ enabled: true, backupCodes: codes })
  }

  static async mfaDisable(adminId: string, password: string) {
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, adminId))
    if (!admin) throw unauthorized('Invalid session')
    if (!(await compare(password, admin.passwordHash))) throw unauthorized('Current password is incorrect')
    await db
      .update(platformAdmins)
      .set({ mfaSecret: null, mfaEnabled: false, mfaBackupCodes: [], tokenVersion: admin.tokenVersion + 1 })
      .where(eq(platformAdmins.id, adminId))
    return ok({ disabled: true })
  }

  /** Verify a login second factor: TOTP code or single-use backup code. */
  static async mfaVerify(adminId: string, input: { code?: string; backupCode?: string }) {
    const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, adminId))
    if (!admin?.mfaEnabled || !admin.mfaSecret) throw badRequest('MFA_NOT_ENABLED', 'MFA is not enabled')
    if (input.code && verifyTotp(admin.mfaSecret, input.code)) {
      return ok({ admin: { id: admin.id, email: admin.email, tokenVersion: admin.tokenVersion }, usedBackupCode: false })
    }
    const normalized = (input.backupCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (normalized) {
      const digest = sha256Hex(normalized)
      const remaining = (admin.mfaBackupCodes ?? []).filter((h) => h !== digest)
      if (remaining.length < (admin.mfaBackupCodes ?? []).length) {
        await db
          .update(platformAdmins)
          .set({ mfaBackupCodes: remaining })
          .where(eq(platformAdmins.id, adminId))
        return ok({ admin: { id: admin.id, email: admin.email, tokenVersion: admin.tokenVersion }, usedBackupCode: true })
      }
    }
    await loginAttempts.increment(attemptKey(admin.email))
    throw unauthorized('Invalid verification code')
  }

  static async listMerchants(q: {

    status?: string
    search?: string
    page?: string
    limit?: string
  }) {
    const { page, limit, offset } = parsePagination(q)
    const conditions = []
    if (q.status) conditions.push(eq(merchants.status, q.status as MerchantStatus))
    if (q.search?.trim()) conditions.push(ilike(merchants.name, `%${q.search.trim()}%`))

    const where = conditions.length ? and(...conditions) : undefined

    const [{ total }] = await db.select({ total: count() }).from(merchants).where(where)
    const rows = await db
      .select()
      .from(merchants)
      .where(where)
      .orderBy(desc(merchants.createdAt))
      .limit(limit)
      .offset(offset)

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        email: r.email,
        status: r.status,
        currency: r.currency,
        timezone: r.timezone,
        deletedAt: r.deletedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString()
      })),
      meta: makeMeta(page, limit, Number(total))
    })
  }

  static async getMerchant(id: string) {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, id))
    if (!merchant) throw notFound('MERCHANT_NOT_FOUND', 'Merchant not found')

    const recentAudit = await AuditService.list(db, id, { limit: '10' })

    return ok({
      merchant: {
        id: merchant.id,
        name: merchant.name,
        slug: merchant.slug,
        email: merchant.email,
        phone: merchant.phone,
        currency: merchant.currency,
        timezone: merchant.timezone,
        status: merchant.status,
        deletedAt: merchant.deletedAt?.toISOString() ?? null,
        createdAt: merchant.createdAt.toISOString()
      },
      allowedNextStatuses: nextStatuses(merchant.status),
      recentAudit: recentAudit.data
    })
  }

  /**
   * Create a merchant with its owner login, default outlet, modules and
   * system roles — everything a fresh store needs to operate immediately.
   * Starts in `trialing` so the owner can sign in right away; the platform
   * can move it through the lifecycle afterwards.
   */
  static async createMerchant(
    input: {
      name: string
      slug: string
      email: string
      phone?: string
      currency?: string
      timezone?: string
      country?: string
      owner: { name: string; email: string; password: string }
    },
    actor: PlatformActor
  ) {
    const slug = input.slug.trim().toLowerCase()
    const email = input.email.trim().toLowerCase()
    const ownerEmail = input.owner.email.trim().toLowerCase()
    validatePassword(input.owner.password)

    const [slugTaken] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, slug))
    if (slugTaken) throw conflict('MERCHANT_SLUG_TAKEN', 'A merchant with this slug already exists')

    const [merchant] = await db
      .insert(merchants)
      .values({
        name: input.name.trim(),
        slug,
        email,
        phone: input.phone?.trim() || null,
        currency: input.currency?.trim().toUpperCase() || 'USD',
        timezone: input.timezone?.trim() || 'UTC',
        country: input.country?.trim().toUpperCase() || null,
        status: 'trialing'
      })
      .returning()

    const [owner] = await db
      .insert(users)
      .values({
        merchantId: merchant.id,
        name: input.owner.name.trim(),
        email: ownerEmail,
        passwordHash: await hash(input.owner.password, 12),
        role: 'owner',
        permissions: [],
        status: 'active'
      })
      .returning({ id: users.id, email: users.email })

    await db.insert(outlets).values({
      merchantId: merchant.id,
      name: 'Main Outlet',
      code: 'MAIN',
      address: {},
      status: 'active'
    })

    const modules: ModuleId[] = [...DEFAULT_MODULES.commerce, 'restaurant', 'tables', 'kitchen', 'delivery']
    await db.insert(merchantModules).values(modules.map((module) => ({ merchantId: merchant.id, module, enabled: true })))

    await db.insert(roles).values(
      DEFAULT_ROLES.map((r) => ({
        merchantId: merchant.id,
        name: r.name,
        isSystem: true,
        permissions: r.permissions as never,
        scope: r.scope as never,
        status: 'active'
      }))
    )

    await AuditService.log(db, {
      merchantId: merchant.id,
      actorUserId: null,
      actorName: actor.email,
      action: 'platform.merchant.created',
      entityType: 'merchant',
      entityId: merchant.id,
      metadata: { slug, ownerEmail }
    })

    return ok({
      merchant: {
        id: merchant.id,
        name: merchant.name,
        slug: merchant.slug,
        email: merchant.email,
        status: merchant.status
      },
      owner: { id: owner.id, email: owner.email }
    })
  }

  /**
   * Full module catalog for one merchant (platform view). Merchants without a
   * row for a module yet report it as disabled so the UI can show the whole
   * catalog with accurate on/off state.
   */
  static async listModulesForMerchant(id: string) {
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, id))
    if (!merchant) throw notFound('MERCHANT_NOT_FOUND', 'Merchant not found')

    const rows = await db
      .select()
      .from(merchantModules)
      .where(eq(merchantModules.merchantId, id))
    const byId = new Map(rows.map((r) => [r.module, r.enabled]))
    return ok(MODULES.map((module) => ({ module, enabled: byId.get(module) ?? false })))
  }

  /** Upsert a single merchant_modules row (platform toggle). */
  static async setMerchantModule(id: string, module: string, enabled: boolean, actor: PlatformActor) {
    const mod = module as ModuleId
    if (!MODULES.includes(mod)) throw badRequest('UNKNOWN_MODULE', `Unknown module: ${module}`)

    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, id))
    if (!merchant) throw notFound('MERCHANT_NOT_FOUND', 'Merchant not found')

    const [existing] = await db
      .select({ id: merchantModules.id })
      .from(merchantModules)
      .where(and(eq(merchantModules.merchantId, id), eq(merchantModules.module, mod)))

    const [row] = existing
      ? await db
          .update(merchantModules)
          .set({ enabled })
          .where(and(eq(merchantModules.merchantId, id), eq(merchantModules.module, mod)))
          .returning()
      : await db
          .insert(merchantModules)
          .values({ merchantId: id, module: mod, enabled })
          .returning()

    await AuditService.log(db, {
      merchantId: id,
      actorUserId: null,
      actorName: actor.email,
      action: 'platform.merchant.module_changed',
      entityType: 'merchant',
      entityId: id,
      metadata: { module: mod, enabled }
    })

    return ok(row)
  }

  static async changeStatus(id: string, to: string, reason: string, actor: PlatformActor) {
    if (!reason?.trim()) throw badRequest('REASON_REQUIRED', 'A reason is required')

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, id))
    if (!merchant) throw notFound('MERCHANT_NOT_FOUND', 'Merchant not found')

    let transition
    try {
      transition = assertTransition(merchant.status, to)
    } catch (e) {
      if (e instanceof IllegalMerchantTransition) {
        throw badRequest('ILLEGAL_TRANSITION', e.message)
      }
      throw e
    }

    await db.update(merchants).set({ status: to as MerchantStatus }).where(eq(merchants.id, id))

    // Offboarding effects for terminal states: no hard delete (retention +
    // audit rows must survive), but the merchant's staff must lose access and
    // an archived merchant gets its soft-delete marker. JWTs need no explicit
    // revocation — every request re-validates merchant status against the DB.
    const effects: Record<string, unknown> = {}
    if (to === 'cancelled' || to === 'archived') {
      const disabled = await db
        .update(users)
        .set({ status: 'disabled' })
        .where(and(eq(users.merchantId, id), eq(users.status, 'active')))
        .returning({ id: users.id })
      effects.usersDisabled = disabled.length
    }
    if (to === 'archived') {
      await db.update(merchants).set({ deletedAt: new Date() }).where(eq(merchants.id, id))
      effects.deletedAt = true
    }

    await AuditService.log(db, {
      merchantId: id,
      // No users row owns a platform admin, so we set actorUserId null and rely
      // on actorName (email) — writing the admin's cuid would violate the FK.
      actorUserId: null,
      actorName: actor.email,
      action: 'platform.merchant.status_changed',
      entityType: 'merchant',
      entityId: id,
      metadata: { from: merchant.status, to, reason: reason.trim(), trigger: transition.trigger, ...effects }
    })

    return ok({
      merchant: {
        id,
        name: merchant.name,
        slug: merchant.slug,
        status: to,
        from: merchant.status,
        ...effects
      }
    })
  }
}