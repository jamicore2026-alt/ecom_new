import { and, count, desc, eq, ilike } from 'drizzle-orm'
import { compare, hash, hashSync } from 'bcryptjs'
import { db } from '../../database/client'
import { merchantModules, merchants, outlets, platformAdmins, roles, users } from '../../database/schema'
import { ok } from '../../shared/response'
import { badRequest, conflict, notFound, unauthorized } from '../../shared/errors'
import { DEFAULT_MODULES, DEFAULT_ROLES, type ModuleId } from '../../shared/types'
import { makeMeta, parsePagination } from '../../shared/pagination'
import {
  assertTransition,
  IllegalMerchantTransition,
  nextStatuses,
  type MerchantStatus
} from '../../shared/merchant-lifecycle'
import { AuditService } from '../audit-logs/service'

/** Burn a bcrypt round for unknown emails so timing doesn't leak account existence. */
const DUMMY_HASH = hashSync('timing-equalizer', 10)
const alwaysCompare = async (password: string) => {
  await compare(password, DUMMY_HASH)
}

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
    const [admin] = await db
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.email, normalized))

    const matches = admin
      ? await compare(password, admin.passwordHash)
      : await alwaysCompare(password).then(() => false)
    if (!admin || !matches) throw unauthorized('Invalid email or password')

    return { id: admin.id, email: admin.email }
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