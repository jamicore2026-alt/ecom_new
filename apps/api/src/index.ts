import { app } from './app'
import { StorefrontService } from './modules/storefront/service'

const port = Number(process.env.PORT ?? 3005)

const EXPIRY_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const sweepExpiredOrders = () =>
  StorefrontService.sweepExpiredOrders().catch((err) =>
    console.error('[payments] expiry sweep failed:', err)
  )

app.listen(port, () => {
  console.log(`🦊 Merchant Dashboard API running at http://localhost:${port}`)
  console.log(`📚 Swagger docs at http://localhost:${port}/docs`)
  setInterval(sweepExpiredOrders, EXPIRY_SWEEP_INTERVAL_MS).unref()
})
