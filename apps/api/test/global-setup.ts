import { beforeAll } from 'bun:test'
import { connection } from '../src/database/client'
import { seed } from '../src/database/seed'

// Isolate each test file against a clean seeded database. Bun runs test files
// against one shared Postgres instance with no isolation; earlier files leave
// rows (e.g. archived menu_items) that later files don't account for, causing
// flaky failures (menu 409/404, promotion usage-limit race). Reseeding at the
// start of every file restores the exact seed state each file's assertions
// assume. Files run serially (--no-threads) so reseeds can't clobber each other.
beforeAll(
  async () => {
    await seed()
  },
  { timeout: 120_000 }
)

// Ensure the pool closes so Bun can exit cleanly.
const onExit = async () => {
  await connection.end()
}
process.once('exit', onExit)
process.once('SIGINT', onExit)