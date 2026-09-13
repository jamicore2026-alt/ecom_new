# Gap Analysis — Multi-Tenant SaaS Platform (Dimension 1)

Scope: JamiCore's mechanics *as a platform*, i.e. what a tenant-scalable, billable SaaS needs around the commerce engine. Every gap is rated **P0 (blocks launch) / P1 (production harden) / P2 (differentiator)** with file-level evidence.

## How tenancy works today

- Tenant = `merchants` row («merchants», `apps/api/src/database/schema.ts:33`, fields: `name, slug, email, phone, currency, timezone, status`). Row-level isolation on a shared schema; no per-tenant DB/schema.
- Two-level scope: merchant → `outlets`, resolved server-side in `apps/api/src/shared/merchant-context.ts:31` (`allowedOutlets` from `user_outlets`, `selectedOutlet` always validated against them).
- Feature gating: `merchant_modules` (`schema.ts:89`) — Boolean per merchant; `enabledModules` carved in `merchant-context.ts:64`; merchants with **no rows inherit `DEFAULT_MODULES.commerce`** (`merchant-context.ts:72`).
- Permission model: authoritative `roles` table + per-user `permissions` overlay (`users.roleId`, `schema.ts:58`); invariant "every request is merchant-scoped" (`docs/business-invariants.md:68`).
- Auditing: `audit_logs`, outbound webhooks + deliveries, `background_jobs`, `api_keys` all tenant-scoped.
- Request protection: endpoint-level sliding-window rate limits (`apps/api/src/shared/rate-limit.ts`, WINDOW_MS 60s, rules keyed by pathname/method) + login-attempt lockout (`modules/auth/login-attempts.ts`).

**Assessment:** tenancy foundation (isolation, scope, RBAC, audit) is solid and test-covered (outlet-scope tests pass). The SaaS layer *around* it is the gap.

---

## Existing modules not yet in the docs (inventory correction)

The SaaS gap list above focuses on the *missing platform layer*. For completeness, the existing surface is 42 API modules / 44 dashboard routes. Modules omitted from the original audit:

- **F&B storefront data model** — `menu_items`, `modifier_groups`, `modifiers`, `menu_item_modifiers`, `menu_item_outlets` (`schema.ts:142-241`). Food orders alone were covered; the menu/modifier model that feeds them is not. Per-outlet availability + price adjustment means one menu, many outlet views.
- **Fulfillments** — `fulfillments` table (`schema.ts:1252`), carrier/tracking-number/label-URL flow, status `unfulfilled → shipped → delivered`.
- **Refunds** — `refunds` (`schema.ts:909`) with idempotency key + attempt count + last-error for retry-safe external refunds (MyFatoorah/Tamara).
- **Idempotency** — `orders.idempotency_key` + `refunds.idempotency_key` with merchant-scoped partial unique indexes; safe checkout/POS double-submit handling.
- **Uploads** — `uploads` module + web `/uploads` + storefront `/uploads/[...path]`, backed by `shared/storage.ts` abstraction.
- **Customer self-service auth** — `customer-auth` module + storefront `/account/forgot|reset|verify`; `customers.email_verified`, `email_verified_at`, `token_version` (session invalidation on password change).
- **Overview** — dashboard aggregate stats endpoint (`overview` module).
- **Procurement** — `suppliers`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items` (`schema.ts:1437-1530`).
- **Production/BOM** — `bill_of_materials`, `bom_items`, `production_orders`, `production_order_items` (`schema.ts:1555-1630`).
- **Kitchen/KDS** — `kitchen_stations`, `kitchen_tickets`, `kitchen_ticket_items` (`schema.ts:611-670`), dashboard `/kds` + `/kitchen`, state machine in `shared/kitchen-state.ts`.

### Shared utilities inventory (27 files in `apps/api/src/shared/`)

Covered by the gap docs: `merchant-context.ts`, `rate-limit.ts`, `table-state.ts`, `delivery-state.ts`, CSV export helpers.

Not previously documented:

| Utility | Purpose |
|---|---|
| `order-state.ts` | Order state machine (authoritative transitions) |
| `kitchen-state.ts` | KOT/kitchen-ticket state machine (status, priority) |
| `inventory.ts` | Stock mutation engine (reserve/release/commit on order flow) |
| `order-cancel.ts` | Single authoritative cancellation op (cancels order + releases stock) |
| `order-payments.ts` | Paid-transition side effects (customer totals, funnel metrics) |
| `revenue.ts` | Profit/revenue aggregation for `analytics`/`overview` |
| `crypto.ts` | AES-256-GCM credential encryption (`payment_provider_configs.credentials`, BYOK) |
| `event-dispatch.ts` | Internal event bus (order placed → webhook/email/reward hooks) |
| `jobs-worker.ts` | Background job worker loop (backing the `background_jobs` table) |
| `outbound-webhook.ts` + `webhook-delivery.ts` + `outbound-url.ts` | Outbound webhook signing, retry, signed-URL generation |
| `mailer.ts` | Email transport layer (`emails` module) |
| `storage.ts` | File storage abstraction (`uploads` module) |
| `product-search.ts` | tsvector product search (`products.search_vector`, GIN) |
| `currency.ts` | Money/number formatting (3-decimal GCC scale) |
| `pagination.ts`, `response.ts`, `errors.ts` | List paging, API envelope, error classes |
| `outlet-scope.ts` | Outlet-scope resolution helper |
| `types.ts` | Shared domain types (`ModuleId`, `TableState`, `KitchenItemStatus`, …) |
| `logger.ts` | Structured logging |

### Under-documented schema columns (earlier migrations)

- `orders.order_type, outlet_id, scheduled_for, table_session_id, warehouse_id, attribution_channel, coupon_code, promotion_id` — the food-order/commerce evolution of the orders table.
- `products.slug` tenant-unique + `products.search_vector` tsvector/GIN.
- `payment_provider_configs.credentials` (AES-256-GCM encrypted).

---

## P0-1 · Merchant self-serve signup & onboarding — MISSING

**Evidence:** the only entry point is the dashboard login (`apps/web/src/routes/login/+page.svelte`), which takes email + `merchantSlug`; no signup/register/provision flow exists in `apps/api/src/modules/*` (searched; only order/product route-registration comments matched). The sole tenant creator is the seed script (`apps/api/src/database/seed.ts`). There is no store setup wizard anywhere.

**Why it's a gap:** a multi-tenant SaaS cannot onboard without a self-serve path. Today every new customer requires a manual DB seed.

**Proposal:** `POST /api/auth/signup` (name, email, password, slug) → provisioning service that:
1. Creates `merchant` (status `trial`) + default `outlet` + owner `user` + default `merchant_modules` rows (from the *selected plan's* entitlements).
2. Issues verified-session tokens; kicks off an onboarding checklist resource (`merchant` → `onboarding_status` column or an `onboarding` table: theme set, product import, outlet address, payment gateway, first test order).
3. Dashboard redirects new tenants into `/onboarding` wizard (route group in `apps/web/src/routes/(app)`).

**Effect on existing code:** `resolveMerchantContext` unchanged; signup writes the same tables `seed.ts` writes.

---

## P0-2 · Plans, entitlements & quota model — MISSING

**Evidence:** `merchants` has no plan reference — the table's only non-core field is `status` (`schema.ts:33-43`). `merchant_modules.enabled` is a binary toggle with no tier/source (`schema.ts:89-99`, `merchant-context.ts:64`). There is no `quota`, `limit`, `seat`, `trial` or `grace` concept anywhere (grep over `shared/merchant-context.ts`, `plugins/auth.ts`, `schema.ts` returned nothing).

**Why it's a gap:** without a plan dimension, "feature gating" can't be sold; without quotas there is no upgrade pressure (the core SaaS loop).

**Proposal (additive):**
```sql
-- migrations/00XX_plans.sql
CREATE TABLE merchant_plans (
  id            text PRIMARY KEY,
  name          text NOT NULL,          -- Free / Starter / Growth
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  stripe_price_id text,
  max_products  int,                     -- NULL = unlimited
  max_outlets   int,
  max_users     int,
  max_orders_month int,                  -- GMV/order quotas
  storage_gb    numeric(8,2),
  modules       jsonb NOT NULL DEFAULT '[]',   -- ModuleId[] enabled
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE merchants ADD COLUMN plan_id text REFERENCES merchant_plans(id);
ALTER TABLE merchants ADD COLUMN trial_ends_at timestamptz;
ALTER TABLE merchants ADD COLUMN plan_status text NOT NULL DEFAULT 'trial'; -- trial|active|past_due|canceled
```
- `resolveMerchantContext` becomes plan-driven: `enabledModules = plan.modules ∪ explicit_overrides` (`merchant_modules` kept as an owner-managed override layer, defaulting rows from the plan at signup; the "no rows → DEFAULT_MODULES" fallback at `merchant-context.ts:72` is replaced by "no rows → default plan modules").
- Quota middleware (`shared/quota.ts` guard next to `rate-limit.ts`) checks plan limits on product/outlet/user/order creates (soft-warn at 80%, hard block above, `429`/`403`).

---

## P0-3 · Billing & subscription engine — MISSING

**Evidence:** `invoices` exist but are **order invoices** (sales documents). There are no subscription tables, no payment-provider webhooks (`payments/myfatoorah.ts`, `payments/tamara.ts` are merchant-side payment gateways, not platform billing), no dunning. grep for `subscription|billing|stripe|paddle|chargebee` in `schema.ts` returns only the order `billing_address`/`is_default_billing` customer fields and a coupon-quota comment.

**Proposal:** add `platform_subscriptions` (`merchant_id, provider, provider_customer_id, provider_subscription_id, plan_id, status, current_period_end`) + `platform_invoices` (billed by Stripe/Paddle webhooks) + `billing_events` log. Merchant chooses plan in-dashboard (`/settings/billing`), checkout is hosted by provider, webhook handler updates `merchant.plan_status` triggering the P0-4 lifecycle.

---

## P0-4 · Merchant lifecycle workflow — MISSING

**Evidence:** `merchants.status` defaults to `active` and is never driven by any state machine (no `trial|past_due|suspended|canceled` handling anywhere; grep over modules/shared found no status transition code).

**Proposal:** mirror the existing order/delivery state-machine pattern (`shared/table-state.ts`, `shared/delivery-state.ts`): a `merchant-state.ts` enumerating transitions `trial → active`, `active → past_due`, `past_due → active|suspended`, `suspended → canceled`, driven by billing webhooks. Login/auth plugin (`plugins/auth.ts`) and `resolveMerchantContext` short-circuit non-`active` tenants with a readable error + `/settings/billing` redirect. Suspension flips public storefront read-only (`storefront/service.ts`).

---

## P0-5 · Platform admin back office — MISSING

**Evidence:** no superadmin/platform role exists (`grep role.*platform|superadmin` → empty). Only merchant-scoped `roles`. There is no route to enumerate tenants, nothing to approve/suspend, no impersonation.

**Proposal:** `users.role = 'platform_admin'` (or `platform_roles` table) checked in `plugins/auth.ts` before merchant-context resolution; new `apps/api/src/modules/platform/*` (list tenants, view usage, suspend/restore, request impersonation token) + `apps/web/src/routes/(platform)/` route group. Kept *out of* `resolveMerchantContext` (it is merchant-scoped by construction) so platform ops don't disturb the tenant invariant.

---

## P1 · Production hardening (quota/enforcement gaps)

- **Usage quotas (real-time), not just endpoint rate limits.** `rate-limit.ts` protects endpoints (per-path keys) — correct but orthogonal. Add per-merchant counters (orders/month, products, seats, storage) checked on create mutations.
- **Plan-driven feature visibility.** `/modules` route in the dashboard (`apps/web/src/routes/(app)/modules/`) should render from server `enabledModules` (already authoritative) and mark plan-locked vs overridden; today it's effectively a manual registry.
- **Tenant data export (GDPR/DPA).** Merchant-side CSV exports exist (`customers-csv`, `csv` modules); add a full-tenant JSON dump endpoint + purge workflow for offboarding.
- **Noisy-neighbor accounting.** Per-merchant request budget via a distributed counter (DB or Redis when added). Today a 10k-rps tenant can starve neighbors; `rate-limit.ts` is per-endpoint global, not per-merchant fair-use.

## P2 · Differentiator gaps

- **SSO / OIDC / SAML + dashboard MFA (TOTP).** Present auth is password + refresh token only (`plugins/auth.ts`, `Modules auth/service.ts`). No external identity anywhere (grep `oidc|sso|saml|totp|mfa` → only false positives). Enterprise tenants will require it.
- **Platform-level white-label.** `theme_configs` covers the storefront only; a multi-tenant SaaS sells the ability to hide the vendor — plan-tier theming (logo, colors, domain) on the dashboard itself.
- **Multi-currency conversion.** `currency` is a per-merchant scalar (`schema.ts:39`); no FX layer. Competitors ship 140+ currencies.
- **API productization.** `api_keys` + webhooks exist; to monetize the platform, add per-key rate tiers, webhook signing public docs, and an API catalog page.
- **Developer/extensibility marketplace.** Long-term option; not P0 (no app-store network effect yet).

---

## Suggested P0 implementation order

1. Schema: plans + `merchant.plan_id/plan_status/trial_ends_at` + subscription tables (all additive).
2. `resolveMerchantContext` plan-driven modules + override layer.
3. Signup/provisioning endpoint + onboarding wizard.
4. Billing webhooks → lifecycle state machine → login/storefront gating.
5. Platform admin module + impersonation.
6. Quota middleware on create mutations.

Each stage has existing seams: provisioning reuses `seed.ts`'s table writes; gating reuses `resolveMerchantContext`; lifecycle reuses the established state-machine utilities.