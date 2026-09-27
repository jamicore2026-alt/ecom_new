import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { app } from './app'
import { pruneBlacklist } from './plugins/auth'
import { StorefrontService } from './modules/storefront/service'
import { OrdersService } from './modules/orders/service'
import { runJobWorker } from './shared/jobs-worker'
import { CartsService } from './modules/carts/service'
import { closeRateLimitStore } from './shared/rate-limit'
import { connection, db } from './database/client'
import { logStorageDriver } from './shared/storage'
import { createLogger } from './shared/logger'

const log = createLogger('startup')

const port = Number(process.env.PORT ?? 3005)

const EXPIRY_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const SWEEPER_INTERVAL_MS = 60 * 1000

const sweepExpiredOrders = () =>
  StorefrontService.sweepExpiredOrders().catch((err) =>
    log.error('expiry sweep failed', err)
  )

const pruneRevokedTokens = () =>
  pruneBlacklist().catch((err) => log.error('blacklist prune failed', err))

// Release refund reservations whose process died between the gateway call and
// the resolution transaction (crash safety — see OrdersService.retryRefund).
const reconcileRefunds = () =>
  OrdersService.reconcileStaleRefunds(db).catch((err) =>
    log.error('reconciliation failed', err)
  )

// Outbound webhook deliveries + durable background job workers.
const runWorkers = () =>
  runJobWorker().catch((err) => {
    log.error('worker failed', err)
  })

// Abandoned carts: after 24h of inactivity, mark + send a recovery email.
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000
const sweepAbandonedCarts = () =>
  CartsService.sweepAbandonedCarts(db, ABANDON_AFTER_MS).catch((err) =>
    log.error('abandoned-cart sweep failed', err)
  )

// Schema drift (e.g. a column added in code but never migrated on the
// deployed database) surfaces as 500s on live traffic. Applying pending
// migrations at boot keeps every environment self-healing: drizzle skips
// already-applied entries, so this is a fast no-op on a current database.
// Failure policy:
// - connection / corrupt-migration errors → fatal (a deploy must visibly
//   fail instead of serving 500s from a half-migrated schema).
// - insufficient_privilege (42501, e.g. CREATE SCHEMA on a locked-down
//   production role) → boot DEGRADED with a loud remediation message.
//   New-schema endpoints will 500 until a privileged role runs the
//   migrations; everything else keeps serving.
try {
  migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
  })
  log.info('Database migrations up to date')
} catch (err) {
  const code =
    (err as { cause?: { code?: string } })?.cause?.code ??
    (err as { code?: string })?.code
  if (code === '42501') {
    log.error(
      'Database migration BLOCKED: this role lacks CREATE privilege (tried CREATE SCHEMA "drizzle"). ' +
        'Booting DEGRADED — endpoints needing newer columns will 500 until migrations run. ' +
        'Fix with a privileged role: GRANT CREATE ON DATABASE "<db>" TO "<app_role>"; ' +
        'or run `bun run db:migrate` as the database owner, then redeploy.',
      err
    )
  } else {
    log.error('Database migration failed — refusing to boot', err)
    process.exit(1)
  }
}

app.listen(port, () => {
  logStorageDriver()
  log.info(`Merchant Dashboard API running at http://localhost:${port}`)
  if (process.env.NODE_ENV !== 'production') {
    log.info(`Swagger docs at http://localhost:${port}/docs`)
  }
  setInterval(sweepExpiredOrders, EXPIRY_SWEEP_INTERVAL_MS).unref()
  setInterval(pruneRevokedTokens, EXPIRY_SWEEP_INTERVAL_MS).unref()
  setInterval(reconcileRefunds, EXPIRY_SWEEP_INTERVAL_MS).unref()
  setInterval(runWorkers, SWEEPER_INTERVAL_MS).unref()
  // Abandoned-cart detection at a coarser interval (hourly) to avoid email floods.
  setInterval(sweepAbandonedCarts, 60 * 60 * 1000).unref()
  // Run once at boot to clear anything queued during a downtime window.
  runWorkers()
})

// Close the rate-limit counter store (Redis RESP socket) cleanly on shutdown so
// hot-reloads / Coolify redeploys don't leave dangling connections behind.
const shutdown = async () => {
  await closeRateLimitStore()
  await connection.end()
  process.exit(0)
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
