import { hash } from 'bcryptjs'
import { sql } from 'drizzle-orm'
import { db } from './client'
import { connection } from './client'
import { platformAdmins } from './schema'

/**
 * Create or reset the platform admin row. Idempotent upsert keyed on email so
 * running it repeatedly (or from tests) can never duplicate accounts.
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

  await db
    .insert(platformAdmins)
    .values({ email, passwordHash: await hash(password, 10) })
    .onConflictDoUpdate({
      target: platformAdmins.email,
      set: { passwordHash: sql`excluded.password_hash` }
    })

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