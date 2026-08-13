import { and, eq } from 'drizzle-orm'
import { compare } from 'bcryptjs'
import { db } from '../../database/client'
import { merchants, users, storeSettings } from '../../database/schema'
import { ok } from '../../shared/response'
import { unauthorized, forbidden, badRequest } from '../../shared/errors'
import type { Merchant, User } from '../../database/schema'

const publicUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  permissions: user.permissions,
  status: user.status
})

const publicMerchant = (merchant: Merchant) => ({
  id: merchant.id,
  name: merchant.name,
  slug: merchant.slug,
  currency: merchant.currency
})

export class AuthService {
  static async login(input: { email: string; password: string; merchantSlug?: string }) {
    const email = input.email.toLowerCase()

    if (input.merchantSlug) {
      const [merchant] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.slug, input.merchantSlug))
      if (!merchant) throw unauthorized('Invalid email or password')

      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.merchantId, merchant.id)))
      return this.validateLogin(user, input.password, merchant)
    }

    const matches = await db.select().from(users).where(eq(users.email, email))
    if (matches.length === 0) throw unauthorized('Invalid email or password')
    if (matches.length > 1) {
      // Same email exists across stores — the user must disambiguate
      throw badRequest('AMBIGUOUS_LOGIN', 'Please specify your store (merchantSlug) to sign in')
    }

    const [merchant] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, matches[0].merchantId))
    return this.validateLogin(matches[0], input.password, merchant)
  }

  private static async validateLogin(
    user: User | undefined,
    password: string,
    merchant: Merchant | undefined
  ) {
    if (!user || !(await compare(password, user.passwordHash))) {
      throw unauthorized('Invalid email or password')
    }
    if (user.status !== 'active') {
      throw forbidden('This account has been disabled')
    }
    if (!merchant || merchant.status !== 'active') {
      throw forbidden('This store is not active')
    }

    return ok({ user: publicUser(user), merchant: publicMerchant(merchant) })
  }

  static async session(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user || user.status !== 'active') throw unauthorized('User no longer exists or is disabled')

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, user.merchantId))
    if (!merchant || merchant.status !== 'active') {
      throw unauthorized('Store is not active')
    }

    const [settings] = await db
      .select()
      .from(storeSettings)
      .where(eq(storeSettings.merchantId, merchant.id))

    return ok({
      user: publicUser(user),
      merchant: publicMerchant(merchant),
      settings: settings ?? null
    })
  }
}