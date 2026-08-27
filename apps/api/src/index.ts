import { app } from './app'
import { pruneBlacklist } from './plugins/auth'
import { StorefrontService } from './modules/storefront/service'
import { OrdersService } from './modules/orders/service'
import { runJobWorker } from './shared/jobs-worker'
import { CartsService } from './modules/carts/service'

const port = Number(process.env.PORT ?? 3005)

const EXPIRY_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const SWEEPER_INTERVAL_MS = 60 * 1000

const sweepExpiredOrders = () =>
  StorefrontService.sweepExpiredOrders().catch((err) =>
    console.error('[payments] expiry sweep failed:', err)
  )

const pruneRevokedTokens = () =>
  pruneBlacklist().catch((err) => console.error('[auth] blacklist prune failed:', err))

// Release refund reservations whose process died between the gateway call and
// the resolution transaction (crash safety — see OrdersService.retryRefund).
const reconcileRefunds = () =>
  OrdersService.reconcileStaleRefunds().catch((err) =>
    console.error('[refunds] reconciliation failed:', err)
  )

// Outbound webhook deliveries + durable background job workers.
const runWorkers = () =>
  runJobWorker().catch((err) => {
    console.error('[jobs] worker failed:', err)
  })

// Abandoned carts: after 24h of inactivity, mark + send a recovery email.
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000
const sweepAbandonedCarts = () =>
  CartsService.sweepAbandonedCarts(ABANDON_AFTER_MS).catch((err) =>
    console.error('[carts] abandoned-cart sweep failed:', err)
  )

app.listen(port, () => {
  console.log(`🦊 Merchant Dashboard API running at http://localhost:${port}`)
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📚 Swagger docs at http://localhost:${port}/docs`)
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
