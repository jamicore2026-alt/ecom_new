import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { errorHandler } from './plugins/errors'
import { authModule } from './modules/auth'
import { overviewModule } from './modules/overview'
import { productsModule } from './modules/products'
import { ordersModule } from './modules/orders'
import { inventoryModule } from './modules/inventory'
import { customersModule } from './modules/customers'
import { discountsModule } from './modules/discounts'
import { analyticsModule } from './modules/analytics'
import { settingsModule } from './modules/settings'
import { storefrontModule } from './modules/storefront'
import { webhooksModule } from './modules/webhooks'
import { uploadsModule } from './modules/uploads'

const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const devOrigins = [/^http:\/\/(localhost|127\.0\.0\.1):(5478|5479)$/]

export const app = new Elysia()
  .onError(errorHandler)
  .use(
    cors({
      origin: corsOrigins.length > 0 ? corsOrigins : devOrigins,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    })
  )
  .use(
    swagger({
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
          { name: 'Analytics', description: 'Sales, products, customers and conversion analytics' },
        { name: 'Settings', description: 'Store, payments, shipping, taxes and staff' },
        { name: 'Storefront', description: 'Public storefront endpoints (no auth required)' },
        { name: 'Webhooks', description: 'Payment provider webhooks (signed/verified server-side)' },
        { name: 'Uploads', description: 'Product image uploads and file serving' }
        ]
      }
    })
  )
  .use(authModule)
  .use(overviewModule)
  .use(productsModule)
  .use(ordersModule)
  .use(inventoryModule)
  .use(customersModule)
  .use(discountsModule)
  .use(analyticsModule)
  .use(settingsModule)
  .use(storefrontModule)
  .use(webhooksModule)
  .use(uploadsModule)

export type App = typeof app
