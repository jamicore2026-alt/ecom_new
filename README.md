# Merchant Dashboard API

A multi-tenant **merchant dashboard REST API** for an e-commerce platform, built with **ElysiaJS**, **Drizzle ORM**, and **PostgreSQL**. Each merchant store is fully isolated by `merchant_id` derived from the authenticated JWT — no cross-tenant data leakage.

> **Deliverable:** Backend API only. All routes are JSON, validated by TypeBox (via `drizzle-typebox`), live-documented at Swagger `/docs`, and consumable by a future frontend through Eden Treaty types.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Project Structure](#4-project-structure)
5. [Database Schema](#5-database-schema)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [API Reference](#7-api-reference)
8. [Validation & Error Handling](#8-validation--error-handling)
9. [Seed Data](#9-seed-data)
10. [Setup & Scripts](#10-setup--scripts)
11. [Frontend Integration](#11-frontend-integration-future)
12. [Roadmap](#12-roadmap)

---

## 1. Overview

The dashboard covers eight merchant-facing domains:

| Section | What it covers |
|---|---|
| 🏠 Overview | KPIs (sales, orders, AOV) + 30-day sales chart |
| 📦 Products | CRUD, categories, variants, bulk edit |
| 🛒 Orders | Status workflow, returns, refunds |
| 📊 Inventory | Stock levels, adjustments, history |
| 👥 Customers | List, details, order history |
| 🎟️ Discounts | Coupons + promotions |
| 📈 Analytics | Sales / products / customers / conversion |
| ⚙️ Settings | Store, payments, shipping, taxes, staff |

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun ≥ 1.3 |
| Framework | ElysiaJS (type-safe, TypeBox validation, zero-config OpenAPI) |
| ORM | Drizzle ORM + `drizzle-kit` migrations |
| Validation | `drizzle-typebox` (Drizzle schema → TypeBox → Elysia validation) |
| Database | PostgreSQL 18 (Docker Compose, port 5432) |
| Driver | `postgres` (porsager) |
| Auth | JWT access/refresh tokens (`@elysiajs/jwt`), bcrypt password hashing |
| IDs | `@paralleldrive/cuid2` |
| Extras | `@elysiajs/cors`, `@elysiajs/swagger` |
| TypeBox pin | `@sinclair/typebox@0.32.4` via npm `overrides` (prevents symbol conflicts) |

---

## 3. Architecture

Feature-based / MVC per the ElysiaJS convention. Every module is three files:

```
modules/<feature>/
├── index.ts     # Controller — routes, validation, cookies, HTTP concerns
├── service.ts   # Service — business logic class (returns `status(...)` errors)
└── model.ts     # Models — TypeBox schemas + exported types
```

### Plugins (explicit dependencies — Elysia encapsulation)

| Plugin | Responsibility |
|---|---|
| `plugins/errors.ts` | Global `onError` → consistent `{ success, error }` JSON |
| `plugins/db.ts` | Decorates `db` (Drizzle instance) on the Elysia context |
| `plugins/auth.ts` | JWT setup + `onBeforeHandle` guard + `role()` macro |

### Elysia conventions applied

- Method chaining only (types are inferred per chain).
- Explicit `.use(plugin)` for anything that adds types (`db`, `auth`).
- Inline handler wrappers for accurate controller typing.
- Pre-declared drizzle-typebox variables before `t.Omit` / `t.Pick` (avoids infinite-type-instantiation).

### Request/Response contract

```
Elysia controller  →  Service class  →  Drizzle ORM  →  PostgreSQL
        │                   │
   TypeBox validate      status() errors
```

---

## 4. Project Structure

```
E:\Ecom_New\
├── docker-compose.yml          # postgres:18-alpine
├── drizzle.config.ts
├── package.json                # scripts: dev, db:generate, db:migrate, db:seed, test
├── tsconfig.json
├── README.md
├── .env.example                # PORT, DATABASE_URL, JWT secrets
└── src/
    ├── index.ts                # bootstrap: errors→db→auth→modules; listen(); export type App
    ├── database/
    │   ├── client.ts           # postgres + drizzle singletons
    │   ├── schema.ts           # all Drizzle tables (see §5)
    │   ├── utils.ts            # spread / spreads helpers
    │   ├── model.ts            # TypeBox insert/select models per table
    │   ├── seed.ts             # realistic demo data (see §9)
    │   └── migrate.ts
    ├── plugins/
    │   ├── errors.ts
    │   ├── db.ts
    │   └── auth.ts             # guard + role macro
    ├── shared/
    │   ├── pagination.ts       # parse page/limit/search → offset/limit
    │   └── types.ts            # enums: orderStatus, orderPaymentStatus, role, couponType…
    └── modules/
        ├── auth/               # login, refresh, logout, me
        ├── overview/           # dashboard KPIs + sales chart
        ├── products/           # + categories + variants + bulk edit
        ├── orders/             # + returns + refunds
        ├── inventory/
        ├── customers/
        ├── discounts/          # coupons + promotions
        ├── analytics/
        └── settings/           # store, payments, shipping, taxes, staff
```

---

## 5. Database Schema

All tables (except `merchants`) carry a `merchant_id` foreign key; every query is filtered by the JWT merchant.

### merchants
| column | type | notes |
|---|---|---|
| `id` | varchar PK (cuid) | |
| `name` / `slug` / `email` / `phone` | varchar | `slug` unique |
| `currency` | varchar | default `USD` |
| `timezone` | varchar | |
| `status` | varchar | `active` / `suspended` |

### users (staff)
| column | type | notes |
|---|---|---|
| `id` / `merchant_id` | varchar PK / FK | |
| `name` / `email` | varchar | `email` unique per merchant |
| `password_hash` | varchar | bcrypt |
| `role` | varchar | `owner` / `admin` / `staff` |
| `permissions` | jsonb | e.g. `["products:write", "orders:read"]` |
| `status` | varchar | `active` / `invited` / `disabled` |
| `created_at` | timestamp | |

### categories
`id, merchant_id, name, slug, parent_id (self-FK, nullable), image, sort_order, status`

### products
| column | type | notes |
|---|---|---|
| `id` / `merchant_id` / `category_id` | varchar PK / FK | |
| `sku` / `barcode` | varchar | |
| `name` / `slug` / `description` | varchar / text | |
| `price` / `compare_at_price` / `cost` | numeric | |
| `track_inventory` | boolean | |
| `low_stock_threshold` | int | default `5` |
| `status` | varchar | `active` / `draft` / `archived` |
| `created_at` / `updated_at` | timestamp | |

### product_variants
`id, product_id FK, option_values jsonb (e.g. {"Size":"M","Color":"Red"}), sku, price, compare_at_price, inventory (int), image`

### inventory_logs
`id, merchant_id, variant_id FK, change (int ±), before, after, reason (sale/adjustment/purchase/return), reference, created_at`

### customers
`id, merchant_id, email, first_name, last_name, phone, tags jsonb, total_spent (numeric), orders_count (int), last_order_at (timestamp), created_at`

### orders
| column | type | notes |
|---|---|---|
| `id` / `merchant_id` / `customer_id` | varchar PK / FK | |
| `order_number` | varchar | e.g. `#1001`, unique per merchant |
| `status` | varchar | `pending` / `processing` / `shipped` / `delivered` / `cancelled` / `refunded` |
| `payment_status` | varchar | `unpaid` / `paid` / `partially_refunded` / `refunded` / `failed` |
| `fulfillment_status` | varchar | `unfulfilled` / `fulfilled` |
| `subtotal` / `shipping_total` / `discount_total` / `tax_total` / `total` | numeric | |
| `currency` | varchar | |
| `shipping_address` / `billing_address` | jsonb | |
| `notes` | text | |
| `created_at` / `updated_at` | timestamp | |

### order_items
`id, order_id FK, product_id, variant_id, name, sku, price, quantity, total`

### returns
`id, merchant_id, order_id, order_item_id FK, quantity, amount, reason, status (pending/approved/rejected/restocked), created_at`

### refunds
`id, merchant_id, order_id, return_id FK, amount, method (original/credit/store_credit), status (pending/completed), created_at`

### coupons
`id, merchant_id, code (unique per merchant), type (percentage/fixed/free_shipping), value, min_subtotal, usage_limit, used_count, starts_at, ends_at, status (active/disabled)`

### promotions
`id, merchant_id, name, type (discount_on_products/buy_x_get_y), discount_percent, applies_to jsonb (product_ids/category_id/all), starts_at, ends_at, status`

### settings — one row per merchant per domain
| table | contents |
|---|---|
| `store_settings` | name, logo, address jsonb, currency, timezone, announcement |
| `payment_settings` | methods jsonb (`[{id:"card",enabled:true},…]`), currency |
| `shipping_settings` | zones jsonb (rates per zone), free_shipping_threshold |
| `tax_settings` | auto_calculate bool, rates jsonb (per region) |

> Analytics are **computed live** via SQL aggregation over orders/products/customers — no denormalized tables.

---

## 6. Authentication & Authorization

### Flow
1. `POST /api/auth/login` with `{ email, password }` → validate bcrypt hash → returns `accessToken` (1h) + `refreshToken` (7d).
2. Client sends `Authorization: Bearer <accessToken>` on every request.
3. Guard (`plugins/auth.ts`) verifies the JWT, loads `user` + `merchant`, and decorates context with `{ user, merchantId }`.
4. `POST /api/auth/refresh` rotates the refresh token; `POST /api/auth/logout` revokes it.

### Roles
| role | scope |
|---|---|
| `owner` | everything |
| `admin` | everything except deleting the owner / changing the owner role |
| `staff` | read-mostly; writes gated by `permissions[]` |

The `role('admin')` macro protects staff-management routes → `403` for insufficient role.

> Every `/api` route except `auth/login` and `auth/refresh` requires a valid token and is scoped to `merchantId`.

---

## 7. API Reference

Base URL: `http://localhost:3000/api` — Swagger UI at `http://localhost:3000/docs`.

### 7.1 Auth

| Method | Path | Body/Query | Description |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | Returns access + refresh token, user |
| POST | `/auth/refresh` | `{ refreshToken }` | New token pair |
| POST | `/auth/logout` | — | Revoke refresh token |
| GET | `/auth/me` | — | Current user + merchant + settings |

### 7.2 Overview

| Method | Path | Description |
|---|---|---|
| GET | `/overview` | `{ todaySales, ordersToday, avgOrderValue, pendingOrders, lowStockCount, outOfStockCount, salesChart[30], recentOrders[10], topProducts[5] }` |

- `salesChart`: `[{ date, revenue, orders }]` for the last 30 days.
- `avgOrderValue`: revenue ÷ order count (excludes cancelled).

### 7.3 Products

| Method | Path | Description |
|---|---|---|
| GET | `/products` | Paginated; query: `page, limit, search, q, status, categoryId, minPrice, maxPrice, lowStock` |
| POST | `/products` | Create product (+ optional variants) |
| GET | `/products/:id` | Product with variants + category |
| PUT | `/products/:id` | Update |
| DELETE | `/products/:id` | Archive (soft delete) |
| POST | `/products/bulk` | `{ ids[], action: set_status\|set_category\|multiply_price\|set_inventory, value }` |
| GET | `/categories` | Tree (nested via `parent_id`) |
| POST | `/categories` | Create |
| PUT / DELETE | `/categories/:id` | Update / delete (products → `category_id` null) |
| GET | `/products/:id/variants` | List variants |
| POST | `/products/:id/variants` | Add variant |
| PUT / DELETE | `/variants/:id` | Update / delete variant |

### 7.4 Orders

| Method | Path | Description |
|---|---|---|
| GET | `/orders` | Filters: `status`, `paymentStatus`, `customerId`, `dateFrom`, `dateTo`, `search`, `page`, `limit` |
| GET | `/orders/:id` | Order + items + customer + returns/refunds |
| PATCH | `/orders/:id/status` | `{ status, paymentStatus?, fulfillmentStatus? }` — transition rules enforced |
| POST | `/orders/:id/cancel` | Cancel → restock inventory, write `inventory_logs` |
| POST | `/returns` | `{ orderId, orderItemId, quantity, reason }` → status `pending` |
| PATCH | `/returns/:id` | `{ status: approved/rejected }`; approve → optional restock |
| POST | `/refunds` | `{ orderId, returnId?, amount, method }` → updates order `payment_status` |
| GET | `/refunds` | List refunds (filter by order) |

**Status flow:** `pending → processing → shipped → delivered`; any → `cancelled`; delivered → `refunded` (via refund).

### 7.5 Inventory

| Method | Path | Description |
|---|---|---|
| GET | `/inventory` | All products + variants with stock (paginated, searchable) |
| GET | `/inventory/low-stock` | Variants where `inventory ≤ low_stock_threshold` |
| GET | `/inventory/out-of-stock` | Variants with `inventory = 0` |
| GET | `/inventory/history` | `inventory_logs` filtered by `variantId`/`productId`/date |
| POST | `/inventory/:variantId/adjust` | `{ change, reason }` → update stock + write log (before/after) |

### 7.6 Customers

| Method | Path | Description |
|---|---|---|
| GET | `/customers` | Paginated; `search` (email/name), `tag`; sort by `total_spent` / `orders_count` / `created_at` |
| GET | `/customers/:id` | Profile + lifetime stats |
| GET | `/customers/:id/orders` | Order history (paginated) |

### 7.7 Discounts

| Method | Path | Description |
|---|---|---|
| GET / POST | `/coupons` | List / create |
| GET / PUT / DELETE | `/coupons/:id` | Detail / update / disable |
| GET / POST | `/promotions` | List / create |
| GET / PUT / DELETE | `/promotions/:id` | Detail / update / disable |

Coupon validation helper: `validateCoupon(code, subtotal)` — checks expiry, `min_subtotal`, `usage_limit`.

### 7.8 Analytics

All endpoints accept `from`, `to` (default: last 30 days) and optional `interval=day|week|month`; compare against the previous equivalent period.

| Method | Path | Response highlights |
|---|---|---|
| GET | `/analytics/sales` | revenue by interval, orders, AOV, refunds, delta % vs previous period |
| GET | `/analytics/products` | top sellers (revenue/qty), low performers, category breakdown |
| GET | `/analytics/customers` | new vs returning, repeat-purchase rate, top spenders, monthly new customers |
| GET | `/analytics/conversion` | conversion rate (orders ÷ visits), funnel `views→cart→checkout→paid`, by channel |

### 7.9 Settings

| Method | Path | Permission | Description |
|---|---|---|---|
| GET / PUT | `/settings/store` | admin | Store identity, address, currency, timezone |
| GET / PUT | `/settings/payments` | admin | Payment methods, currency |
| GET / PUT | `/settings/shipping` | admin | Shipping zones/rates, free-shipping threshold |
| GET / PUT | `/settings/taxes` | admin | Auto-calc toggle, tax rates |
| GET | `/settings/staff` | admin | List staff |
| POST | `/settings/staff` | admin | Create/invite staff (role, permissions) |
| PUT / DELETE | `/settings/staff/:id` | admin | Update role/permissions / disable (owner protected) |

### Common response shape

```json
// 2xx
{ "success": true, "data": { } }

// 4xx / 5xx
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Product not found" } }
```

Paginated lists additionally return:

```json
{ "data": [ ], "meta": { "page": 1, "limit": 20, "total": 120, "totalPages": 6 } }
```

---

## 8. Validation & Error Handling

- Every request body/query/params is validated by TypeBox schemas built from Drizzle tables via `drizzle-typebox` (`createInsertSchema` / `createSelectSchema`) + the `spread` / `spreads` utilities.
- Domain rules (order transitions, coupon logic, stock math) are validated in services; services return `status(400 | 403 | 404 | 409, …)` rather than throwing.
- `plugins/errors.ts` maps validation errors → `400` with field details; unknown errors → `500` with a generic message (details logged server-side).

---

## 9. Seed Data

Run with `bun run db:seed`. Generates:

1. **Merchant** — "Acme Store" (`acme-store`)
2. **Users** — owner + admin + 2 staff (demo login: `admin@acme.com` / `password123`)
3. **Categories** — 8 top-level (Clothing, Footwear, Accessories, Electronics, Home, Beauty, Sports, Books) with nested sub-categories
4. **Products** — 20 with SKUs, prices, compare-at prices, some with 2–4 variants (size/color); varied `track_inventory` and `low_stock_threshold`; several low-stock and out-of-stock for dashboard demos
5. **Customers** — 40 with realistic names; mix of one-time and returning (multiple orders, high `total_spent`)
6. **Orders** — ~120 spread over 90 days across all statuses, with 1–5 items, computed totals, some with returns/refunds; stock decremented/restored consistently with logs
7. **Discounts** — 5 coupons (percentage / fixed / free-shipping; some expired) + 3 promotions
8. **Settings** — store / payments / shipping / taxes rows for the merchant
9. **Analytics base** — daily `visits` aggregates per channel for conversion math

The seed is **idempotent** — re-running upserts by slug/code/sku instead of duplicating.

---

## 10. Setup & Scripts

```bash
# 1. Start the database
docker compose up -d            # postgres:18-alpine on :5432

# 2. Install dependencies
bun install

# 3. Configure environment
cp .env.example .env            # defaults work out of the box

# 4. Migrate + seed
bun run db:generate             # generate migration from schema
bun run db:migrate              # apply migrations
bun run db:seed                 # load demo data

# 5. Run
bun run dev                     # http://localhost:3000 — Swagger at /docs
```

### Scripts

| Script | Command |
|---|---|
| `dev` | `bun --watch src/index.ts` |
| `start` | `bun src/index.ts` |
| `db:generate` | `drizzle-kit generate` |
| `db:migrate` | `drizzle-kit migrate` |
| `db:seed` | `bun src/database/seed.ts` |
| `test` | `bun test` (smoke: login → overview → orders) |

### `.env.example`

```
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ecom_merchant
JWT_ACCESS_SECRET=change-me-access
JWT_REFRESH_SECRET=change-me-refresh
```

---

## 11. Frontend Integration (future)

`src/index.ts` exports `export type App = typeof app`. A frontend can generate a fully type-safe client:

```ts
import { edenTreaty } from '@elysiajs/eden'

const client = edenTreaty<App>('http://localhost:3000')

await client.api.overview.get({
  headers: { authorization: `Bearer ${token}` }
})
```

---

## 12. Roadmap

- [ ] Auth module + end-to-end login verification
- [ ] Overview KPIs + sales chart
- [ ] Products (categories, variants, bulk edit)
- [ ] Orders (status workflow, returns, refunds)
- [ ] Inventory (adjustments + history)
- [ ] Customers
- [ ] Discounts (coupons + promotions)
- [ ] Analytics (sales / products / customers / conversion)
- [ ] Settings (store, payments, shipping, taxes, staff)
- [ ] Swagger polish, Eden export, smoke tests
