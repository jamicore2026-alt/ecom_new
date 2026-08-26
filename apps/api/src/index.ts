import { app } from './app'
import { pruneBlacklist } from './plugins/auth'
import { StorefrontService } from './modules/storefront/service'
import { OrdersService } from './modules/orders/service'

const port = Number(process.env.PORT ?? 3005)

const EXPIRY_SWEEP_INTERVAL_MS = 5 * 60 * 1000
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

app.listen(port, () => {
  console.log(`🦊 Merchant Dashboard API running at http://localhost:${port}`)
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📚 Swagger docs at http://localhost:${port}/docs`)
  }
  setInterval(sweepExpiredOrders, EXPIRY_SWEEP_INTERVAL_MS).unref()
  setInterval(pruneRevokedTokens, EXPIRY_SWEEP_INTERVAL_MS).unref()
  setInterval(reconcileRefunds, EXPIRY_SWEEP_INTERVAL_MS).unref()
})
