import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { errorHandler } from './plugins/errors'
import { rateLimiter, initializeRateLimitStore } from './shared/rate-limit'
import { authModule } from './modules/auth'
import { overviewModule } from './modules/overview'
import { productsModule } from './modules/products'
import { ordersModule } from './modules/orders'
import { inventoryModule } from './modules/inventory'
import { customersModule } from './modules/customers'
import { discountsModule } from './modules/discounts'
import { reviewsModule } from './modules/reviews'
import { analyticsModule } from './modules/analytics'
import { settingsModule } from './modules/settings'
import { storefrontModule } from './modules/storefront'
import { customerAuthModule } from './modules/customer-auth'
import { webhooksModule } from './modules/webhooks'
import { outboundWebhooksModule } from './modules/outbound-webhooks'
import { fulfillmentsModule } from './modules/fulfillments'
import { cartsModule } from './modules/carts'
import { invoicesModule } from './modules/invoices'
import { warehousesModule } from './modules/warehouses'
import { apiKeysModule } from './modules/api-keys'
import { loyaltyModule } from './modules/loyalty'
import { affiliatesModule } from './modules/affiliates'
import { segmentsModule } from './modules/segments'
import { contentModule } from './modules/content'
import { themeModule } from './modules/theme'
import { campaignsModule } from './modules/campaigns'
import { profitModule } from './modules/profit'
import { customerTagsModule } from './modules/customer-tags'
import { auditLogsModule } from './modules/audit-logs'

import { uploadsModule } from './modules/uploads'
import { outletsModule } from './modules/outlets'
import { modulesModule } from './modules/modules'
import { rolesModule } from './modules/roles'
import { userOutletsModule } from './modules/user-outlets'
import { menuModule } from './modules/menu'
import { foodOrdersModule } from './modules/food-orders'

await initializeRateLimitStore()

const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const devOrigins = [/^http:\/\/(localhost|127\.0\.0\.1):(5478|5479)$/]

export const app = new Elysia({
  // Cap request bodies (uploads are separately limited to 5MB by the upload model).
  serve: { maxRequestBodySize: 8 * 1024 * 1024 }
})
  .onAfterHandle(({ request, set }) => {
    set.headers['X-Frame-Options'] = 'DENY'
    set.headers['X-Content-Type-Options'] = 'nosniff'
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    if (process.env.NODE_ENV === 'production') {
      set.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains'
    }
    const pathname = new URL(request.url).pathname
    const isDocs = pathname === '/docs' || pathname.startsWith('/docs/')
    set.headers['Content-Security-Policy'] = isDocs && process.env.NODE_ENV !== 'production'
    ? "default-src 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    : "default-src 'self'; frame-ancestors 'none'"
  })
  .onError(errorHandler)
  .use(rateLimiter)
  .use(
    cors({
      origin: corsOrigins.length > 0 ? corsOrigins : devOrigins,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    })
  )
  .use(
    // Never expose route documentation to anonymous visitors in production.
    process.env.NODE_ENV !== 'production'
      ? swagger({
          path: '/docs',
          documentation: {
        info: {
          title: 'Merchant Dashboard API',
          version: '1.0.0',
          description:
            'Multi-tenant e-commerce merchant dashboard API built with ElysiaJS, Drizzle ORM and PostgreSQL.'
        },
        tags: [
          { name: 'Auth', description: 'Sign in, refresh and session' },
          { name: 'Overview', description: 'Dashboard KPIs and sales chart' },
          { name: 'Products', description: 'Products, categories, variants and bulk edit' },
          { name: 'Orders', description: 'Orders, status workflow, returns and refunds' },
          { name: 'Inventory', description: 'Stock levels, adjustments and history' },
          { name: 'Customers', description: 'Customer directory and order history' },
          { name: 'Discounts', description: 'Coupons and promotions' },
          { name: 'Reviews', description: 'Product review moderation' },
          { name: 'Audit Logs', description: 'Merchant activity trail and audit history' },
          { name: 'Analytics', description: 'Sales, products, customers and conversion analytics' },
        { name: 'Settings', description: 'Store, payments, shipping, taxes and staff' },
        { name: 'Storefront', description: 'Public storefront endpoints (no auth required)' },
        { name: 'Webhooks', description: 'Payment provider webhooks (signed/verified server-side)' },
        { name: 'Uploads', description: 'Product image uploads and file serving' }
        ]
      }
    })
      : new Elysia({ name: 'swagger-disabled' })
  )
  // Liveness probes (Coolify/k8s/load balancers). Deliberately DB-free and
  // rate-limit-exempt so a busy API can never fail its own healthcheck.
  .get('/health', () => ({ status: 'ok' }))
  .get('/', () => ({ status: 'ok', service: 'merchant-dashboard-api' }))
  .use(authModule)
  .use(overviewModule)
  .use(productsModule)
  .use(ordersModule)
  .use(inventoryModule)
  .use(customersModule)
  .use(discountsModule)
  .use(reviewsModule)
  .use(analyticsModule)
  .use(settingsModule)
  .use(storefrontModule)
  .use(customerAuthModule)
  .use(webhooksModule)
  .use(outboundWebhooksModule)
  .use(fulfillmentsModule)
  .use(cartsModule)
  .use(invoicesModule)
  .use(warehousesModule)
  .use(apiKeysModule)
  .use(loyaltyModule)
  .use(affiliatesModule)
  .use(segmentsModule)
  .use(contentModule)
  .use(themeModule)
  .use(campaignsModule)
  .use(profitModule)
  .use(customerTagsModule)
  .use(auditLogsModule)
  .use(uploadsModule)
  .use(outletsModule)
  .use(modulesModule)
  .use(rolesModule)
  .use(userOutletsModule)
  .use(menuModule)
  .use(foodOrdersModule)

export type App = typeof app
