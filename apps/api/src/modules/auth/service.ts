import { and, eq } from 'drizzle-orm'
import { compare, hashSync } from 'bcryptjs'
import { db } from '../../database/client'
import { merchants, roles, users, storeSettings } from '../../database/schema'
import { ok } from '../../shared/response'
import { unauthorized, forbidden, badRequest } from '../../shared/errors'
import { resolveMerchantContext } from '../../shared/merchant-context'
import { isOperational } from '../../shared/merchant-lifecycle'
import { normalizePermissions } from '../../shared/types'
import { loginAttempts } from './login-attempts'
import type { Merchant, Role, User } from '../../database/schema'

/** Burn a bcrypt round for unknown emails so timing doesn't leak account existence. */
const DUMMY_HASH = hashSync('timing-equalizer', 10)
const alwaysCompare = async (password: string) => {
  await compare(password, DUMMY_HASH)
}

const publicUser = (user: User, role: Role | null = null) => {
  const effectivePermissions = normalizePermissions([
    ...(role?.permissions ?? []),
    ...user.permissions
  ])
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    roleId: user.roleId ?? null,
    permissions: user.permissions,
    effectivePermissions,
    status: user.status,
    isAdmin: user.role === 'owner' || user.role === 'admin'
  }
}

const loadUserRole = async (user: User): Promise<Role | null> => {
  if (!user.roleId) return null
  const [role] = await db.select().from(roles).where(eq(roles.id, user.roleId))
  return role ?? null
}

const publicMerchant = (merchant: Merchant) => ({
  id: merchant.id,
  name: merchant.name,
  slug: merchant.slug,
  currency: merchant.currency,
  status: merchant.status
})

export class AuthService {
  static async login(input: { email: string; password: string; merchantSlug?: string }) {
    const email = input.email.trim().toLowerCase()

    // Account-level lockout is independent of IP so rotating source IPs cannot
    // bypass the password-guessing threshold. Keep the dummy bcrypt compare on
    // the locked path so the lock itself does not become an account oracle.
    if (await loginAttempts.get(email)) {
      await alwaysCompare(input.password)
      throw unauthorized('Invalid email or password')
    }

    if (input.merchantSlug) {
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.slug, input.merchantSlug))
      if (!merchant) {
        await alwaysCompare(input.password)
        await loginAttempts.increment(email)
        throw unauthorized('Invalid email or password')
      }

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.merchantId, merchant.id)))
      return this.validateLogin(user, input.password, merchant, email)
    }

    const matches = await db.select().from(users).where(eq(users.email, email))
    if (matches.length === 0) {
      await alwaysCompare(input.password)
      await loginAttempts.increment(email)
      throw unauthorized('Invalid email or password')
    }

    // Compare against every store sharing this email; only a password that
    // actually matches several accounts triggers disambiguation (no existence oracle).
    const comparisons = await Promise.all(
      matches.map(async (user) => ((await compare(input.password, user.passwordHash)) ? user : null))
    )
    const candidates = comparisons.filter((u): u is User => u !== null)

    if (candidates.length > 1) {
      // Same email + same password across stores — the user must disambiguate
      throw badRequest(
        'AMBIGUOUS_LOGIN',
        'Please specify your store (merchantSlug) to sign in'
      )
    }
    if (candidates.length === 1) {
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, candidates[0].merchantId))
      return this.validateLogin(candidates[0], input.password, merchant, email)
    }

    await loginAttempts.increment(email)
    throw unauthorized('Invalid email or password')
  }

  private static async validateLogin(
    user: User | undefined,
    password: string,
    merchant: Merchant | undefined,
    email: string
  ) {
    const passwordMatches = user
      ? await compare(password, user.passwordHash)
      : await alwaysCompare(password).then(() => false)

    if (!user || !passwordMatches) {
      await loginAttempts.increment(email)
      throw unauthorized('Invalid email or password')
    }
    if (user.status !== 'active') {
      throw forbidden('This account has been disabled')
    }
    if (!merchant || !isOperational(merchant.status)) {
      throw forbidden('This store is not active')
    }

    await loginAttempts.reset(email)
    const role = await loadUserRole(user)
    return ok({ user: publicUser(user, role), merchant: publicMerchant(merchant) })
  }

  static async session(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user || user.status !== 'active') throw unauthorized('User no longer exists or is disabled')

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, user.merchantId))
    if (!merchant || !isOperational(merchant.status)) {
      throw unauthorized('Store is not active')
    }

    const [settings] = await db
      .select()
      .from(storeSettings)
      .where(eq(storeSettings.merchantId, merchant.id))

    const role = await loadUserRole(user)
    const context = await resolveMerchantContext(
      db,
      user.id,
      merchant.id,
      user.role === 'owner' || user.role === 'admin',
      null,
      role?.scope ?? (user.role === 'owner' || user.role === 'admin' ? 'GLOBAL' : 'OUTLET')
    )
    return ok({
      user: publicUser(user, role),
      merchant: publicMerchant(merchant),
      settings: settings ?? null,
      allowedOutlets: context.allowedOutlets,
      selectedOutlet: context.selectedOutlet,
      enabledModules: context.enabledModules
    })
  }
}