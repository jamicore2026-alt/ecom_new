import { hash } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from './client'
import { connection } from './client'
import { platformAdmins } from './schema'
import { validatePassword } from '../shared/password'

/**
 * Create the platform admin row if missing. Idempotent and non-destructive:
 * an existing row (password, status, MFA) is never touched, so re-running
 * the seed — or a deploy hook — can neither lock out nor take over the
 * account. Returns the email.
 *
 * Not part of the merchant seed: `db:seed` restores a fixed demo state and
 * must NOT be able to wipe a real admin row, so this lives as its own script
 * (`bun run db:seed:platform`) and as a helper for the platform test suite.
 */
export async function ensurePlatformAdmin(opts?: { email?: string; password?: string }): Promise<string> {
  const email = (opts?.email ?? process.env.PLATFORM_ADMIN_EMAIL ?? 'owner@jamicore.com')
    .trim()
    .toLowerCase()
  const password = opts?.password ?? process.env.PLATFORM_ADMIN_PASSWORD ?? 'password123'
  const usingDefault = !opts?.password && !process.env.PLATFORM_ADMIN_PASSWORD
  if (process.env.NODE_ENV === 'production' && usingDefault) {
    throw new Error('Refusing to seed the default platform-admin password in production: set PLATFORM_ADMIN_PASSWORD')
  }
  if (usingDefault && process.env.NODE_ENV !== 'production') {
    // Local-dev convenience only: the well-known default intentionally
    // bypasses the complexity policy. Never rely on this in production.
    console.warn('Seeding default platform-admin password (dev only, fails password policy)')
  } else {
    validatePassword(password)
  }

  const [existing] = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email))
  if (existing) return email

  await db.insert(platformAdmins).values({ email, passwordHash: await hash(password, 12) })

  return email
}

if (import.meta.main) {
  ensurePlatformAdmin()
    .then((email) => console.log(`Platform admin ready: ${email}`))
    .catch((e) => {
      console.error('Failed to seed platform admin:', e)
      process.exit(1)
    })
    .finally(async () => {
      await connection.end()
    })
}