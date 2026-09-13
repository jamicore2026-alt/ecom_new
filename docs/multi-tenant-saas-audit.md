# Multi-Tenant SaaS Evidence Audit

Scope: JamiCore monorepo (`apps/api`, `apps/web`, `apps/storefront`).
Method: evidence-only. Every claim cites `file:line`, a table, a route, or a test.
Status vocabulary: **IMPLEMENTED** · **PARTIALLY IMPLEMENTED** · **DOCUMENTED-PLANNED** · **UNVERIFIED** · **NOT IMPLEMENTED**.
Graph evidence is used only as a navigation aid; absence is asserted only after explicit greps across `apps/api/src`, `apps/web/src`, `apps/storefront/src`, and `apps/api/drizzle/*.sql`.

---

## 1. Tenant Model Overview

**Status: IMPLEMENTED**

- Pooled single-database multi-tenant. 86 tenant-relevant tables; tenant classification:
  **Platform 2** (`merchants`, `webhook_events` predicted platform), **Merchant 61** (7 via inherited FK), **Outlet 11**, **User 2**, **Customer 10**.
  Evidence: `apps/api/scripts/tenant-scope-inventory.ts`, `docs/tenant-scope-inventory.md`.
- Every merchant-owned table carries a `merchantId` column; every outlet-owned table carries `merchantId` + `outletId`.
  Inherited-scope tables (customer-owned: carts, addresses, wishlists, customer_tokens, loyalty, etc.) reach merchant scope through `customer → merchant`.
- Tenant is **not** encoded in the JWT. It is re-derived from the database on every protected request (`resolveMerchantContext`), which means cross-tenant impersonation cannot persist past a DB state change.

## 2. Transaction / Table Granularity

**Status: IMPLEMENTED**

- Shared-scope resolution helpers: `apps/api/src/shared/merchant-context.ts` (`resolveMerchantContext`) and `apps/api/src/shared/outlet-scope.ts` (`outletScope`, `activeOutletIdKey`).
- Carts/accounts are client-side and slug-scoped: `ecom:cart:{slug}` (`apps/web/src/lib/cart/values/cart.svelte.ts:17-18`), `ecom:account:{slug}`. No server-side shared cart pool leaking across merchants.
- Storage keys are tenant-partitioned: `{merchantId}/{id}.{ext}` (`apps/api/src/shared/storage.ts`, `apps/api/src/modules/uploads/index.ts`); `sanitizeKey` strips `..` and leading slashes; public read path is registered before the auth guard and serves static uploads only.

## 3. Query-Level Tenant Isolation

**Status: IMPLEMENTED** (0 exploitable findings from an exhaustive module-by-module pass)

Classification surveyed every module in `apps/api/src/modules/*`:

| Category | Count |
|---|---|
| SAFE (explicit `merchantId`/`outletId` predicate or designed-public) | 35 |
| SAFE-BY-HANDLER (id-only query under a proven merchant-scoped guard) | 5 |
| OFFLINE / INTERNAL (workers, seed, scripts) | 5 worker jobs + 2 files |
| POTENTIAL CROSS-TENANT RISK | **0** |

Two candidates were investigated and resolved:
- `apps/api/src/modules/content/service.ts:26` `getBySlug` (slug-only, unique only per merchant) — **dead code**, zero callers, unreachable from any route.
- `apps/api/src/shared/inventory.ts` / `modules/warehouses/service.ts` variant-by-id lookup — **SAFE-BY-HANDLER**: variant IDs are unguessable UUIDs, query never reads a row back to a caller, all callers sit behind merchant-scoped handlers. Hardening note (low priority): add a `products.merchantId` join to make the boundary explicit.

SAFE-BY-HANDLER list (id-only secondary reads behind proven guards): fulfillments `sendShippedEmail` (order merchant-validated first), procurement `assertPoInMerchant`, production `assertBomInMerchant`, emails service (merchant-scoped flows only), orders `get`/refunds/returns (order resolved with `merchantId` + scope first; refund idempotency key merchant-scoped), storefront variant lock `FOR UPDATE` includes `products.merchantId` → `TENANT_MISMATCH` on mismatch (`storefront/service.ts:1052-1057`), syncOrder/order by `merchantId` + `orderNumber` (1562, 1652), menu/kitchen/tables/menuItemOutlets/customer-auth rows all merchant- or customer-scoped before mutation.

## 4. Row-Level Security (RLS)

**Status: NOT IMPLEMENTED (UNVERIFIED — no RLS statements in the repository)**

- All 29 migrations under `apps/api/drizzle/*.sql` contain **no** `CREATE POLICY`, no `ENABLE ROW LEVEL SECURITY`, no `FORCE ROW LEVEL SECURITY`.
- Grep across the repo for `row_level_security` / `create policy` / `rls` returns nothing beyond this doc.
- Tenant isolation is therefore app-layer only (query predicates + guards), never DB-enforced. This is the single largest defense-in-depth gap.
- **DOCUMENTED-PLANNED** mitigation: none in repo. Recommend PRAGMA/Postgres RLS as a hardening follow-up (tracked, not implemented).

## 5. Application-Layer Enforcement Chain

**Status: IMPLEMENTED**

Per-request enforcement on every protected route:
1. `plugins/auth.ts` `derive` re-reads the user **and** merchant from DB on each request (142-173); non-active users rejected; merchant must be in `OPERATE_STATUSES` via `inArray(merchant.status, OPERATE_STATUSES)` (`plugins/auth.ts:163`).
2. `outletGuard` (`plugins/outlet.ts`) order: auth → module → outlet scope → permission (36-41).
3. `resolveMerchantContext` validates `selectedOutlet` ∈ `allowedOutlets` (`merchant-context.ts:58-62`).
4. `requirePermission` enforces RBAC `hasPermission` (any-of; admin bypasses) (`plugins/auth.ts:51-62`).
5. Storefront resolves merchant by slug and serves only `status = 'active'` (`storefront/service.ts`, `PUBLIC_STATUSES`).

## 6. Authentication (Admin)

**Status: IMPLEMENTED**

- Email+password; argon2id hashing. Login rate-limit + per-email lockout: 5 failures / 15 min, `login-lock:{email}` 15 min (`modules/auth/login-attempts.ts:3-26`).
- Token blacklist: revoked `jti` persisted to `token_blacklist`, pruned daily (`pruneRevokedTokens`).
- Elysia response validators strip unknown fields; `authMerchant` schema includes `status` so lifecycle state survives serialization (`modules/auth/model.ts`).

## 7. Session / Token Lifecycle

**Status: PARTIALLY IMPLEMENTED**

- JWT claims: `sub`, `role`, `type`, `jti`, `exp`. **No `merchantId` claim** — merchant identity re-derived from DB per request, which is safer than a stale claim but adds a DB round-trip per request.
- Separate token classes: admin vs customer; `refresh` vs `access`.
- Rotation/logout: present (blacklist + refresh re-issue).
- Long-lived sessions, device enumeration, and cross-device revocation beyond blacklisting: **NOT IMPLEMENTED** (no session table).

## 8. API Keys

**Status: PARTIALLY IMPLEMENTED**

- `api_keys` table exists (`schema.ts:1815`) with scoped keys.
- Runtime call sites that *consume* API keys for platform access: **none found** (no `Authorization: Bearer` key check outside JWT). Payment gateway credentials are merchant BYOK, stored encrypted (AES-256-GCM) in `payment_provider_configs` (`schema.ts:1018-1034`) and validated only client-side.
- No platform/partner API-key auth path for the API. **UNVERIFIED** that `api_keys` rows are ever issued/used at runtime.

## 9. Roles & Permissions (RBAC)

**Status: IMPLEMENTED** (with policy gaps)

- Default roles: `owner`, `admin`, `manager`, `staff` (docs comment, `types.ts:162`).
- `hasPermission` (any-of), admin bypass, `requirePermission` across modules.
- **Gap**: no per-role `PRESET` enforcement beyond seed; permission strings are merchant-agnostic (a super-admin at merchant A is only ever scoped to A because context resolves merchant-scope at request time). Verified safe via derive + `resolveMerchantContext`.

## 10. Feature Entitlements (merchant_modules)

**Status: PARTIALLY IMPLEMENTED**

- Catalog: 9 modules (`commerce, restaurant, pos, kitchen, tables, delivery, inventory, marketing, analytics`) (`apps/api/src/shared/types.ts:399-410`).
- `merchant_modules` table (`(merchantId, module)` unique, `enabled` default true, `schema.ts:90-100`).
- `resolveMerchantContext` computes `enabledModules`; **fallback**: merchants with zero rows get `DEFAULT_MODULES.commerce` = {commerce, inventory, marketing, analytics} (`merchant-context.ts:72-74`) — explicit `enabled=false` still disables.
- Enforcement: `outletGuard` `module:` check → 403 `MODULE_DISABLED` (`plugins/outlet.ts:66-70`).
- **Coverage gap**: only 16 call sites across 5 restaurant-side modules enforce `module:` gating (delivery ×5, kitchen ×3, tables ×2, food-orders/restaurant ×4, menu/restaurant ×2). Core commerce surface — `products`, `orders`, `customers`, `discounts`, `inventory`, `reviews`, `analytics`, `invoices`, `settings` — uses only `authPlugin` + permissions and is **not** module-gated. A merchant with `commerce: false` can still hit `/api/products`, `/api/orders`, etc.
- Web UI hides nav items only (`session.svelte.ts:53-60`) — UX-only, not a security boundary.

## 11. Usage Quotas / Limits

**Status: NOT IMPLEMENTED**

- Grep for `quota`, `maxOutlets`, `maxProducts`, `maxUsers`, `overLimit`, `entitlement` → zero entitlement-tier hits.
- Existing limits are hygiene/security, not tenant quotas: 8 MB body cap (`app.ts:63`), 5 MB upload (`storage.ts:6,67,106`), pagination caps page≤1000/limit≤100 (`pagination.ts:22-23`), coupon/promotion `usageLimit`/`usedCount` (merchant-configured), COD min/max order value (`storefront/service.ts:972-980`), login lockout.
- **DOCUMENTED-PLANNED**: `docs/gap-analysis-saas.md:90-143` proposes `merchant_plans` (max_products/outlets/users, orders/month, storage_gb) and real-time usage counters. Not implemented.

## 12. SaaS Billing vs Commerce Payments

**Status: NOT IMPLEMENTED (SaaS billing) — IMPLEMENTED (commerce payments)**

- 100% order-level commerce payments: `payment_transactions` (`orderId` NOT NULL FK → `orders.id`, `schema.ts:1036-1057`), `webhook_events` idempotency (`(provider, eventId)` unique, 1059-1070), `invoices` = order tax invoices (`orderId` FK, per-order numbering INV-0001, 1342-1371), coupons = promo codes.
- Adapters: MyFatoorah (`SendPayment`/`GetPaymentStatus`/`MakeRefund`) and Tamara (BNPL single order) — both one-shot order payments; no recurring/mandate/interval (payments/types.ts, myfatoorah.ts, tamara.ts).
- `merchants` has **no** `plan_id`, `trial_ends_at`, `billing_customer_id`, `subscription_id` (`schema.ts:34-44`).
- Grep `subscription|billingCustomer|merchant_subscription|plan_version|stripe|recurring` across api/web/storefront/drizzle → **0 implementable entities**. Only irrelevant hits: `billingAddress` order field, one orphan i18n key, a lifecycle trigger *label*.
- **DOCUMENTED-PLANNED**: `docs/gap-analysis-saas.md:114-118` (billing engine proposal).

## 13. Merchant Lifecycle

**Status: PARTIALLY IMPLEMENTED**

- `shared/merchant-lifecycle.ts`: 7 statuses (`pending|trialing|active|past_due|suspended|cancelled|archived`), `OPERATE_STATUSES = [active, trialing, past_due]`, `PUBLIC_STATUSES = [active]`, 9 legal transitions (incl. `any → suspended`), `assertTransition`, `isOperational`, `isPubliclyServable`. `merchants.status` typed `$type<MerchantStatus>()` (`schema.ts:41`).
- Enforcement: auth derive (OPERATE_STATUSES) + storefront (PUBLIC_STATUSES) → suspended/cancelled/archived/pending are hard-blocked on every request; 11 tests in `test/merchant-lifecycle.test.ts`.
- **Gap**: nothing ever *transitions* status (no dunning/scheduler/billing webhook writes transitions; `assertTransition` has no call sites outside the file). Statuses are enforced but static — the state machine is definitionally complete yet un-driven.

## 14. Storefront Tenant Resolution

**Status: IMPLEMENTED**

- Resolves merchant by URL slug + `status='active'` (`storefront/service.ts`, `PUBLIC_STATUSES`). Order reports gated by `merchantId` + CSPRNG-suffix order number; rate-limited GET. Cart keys slug-scoped client-side.
- No server-side session shared across merchants; storage merchant-partitioned.

## 15. Inbound Webhooks (Payment Callbacks)

**Status: IMPLEMENTED**

- `POST /api/webhooks/:provider/:slug`: merchant by slug+active → BYOK config → adapter `verifyCallback` (signature per merchant) → idempotent dedup via `webhook_events` unique `(provider, eventId)` → `OrdersService.applyPaymentResult`. Rate-limited `/api/webhooks/` 240/min.
- No cross-tenant correlation possible: event key is provider+eventId, and merchant identity comes from the active slug.

## 16. Outbound Webhooks / Background Jobs

**Status: PARTIALLY IMPLEMENTED**

- Job worker only handles webhook deliveries (`shared/jobs-worker.ts`, `shared/webhook-delivery.ts`); deliveries authenticated via per-endpoint stored secret.
- `background_jobs` table exists; only job type in the union is webhook deliveries (`types.ts:453`) plus an unregistered `invoice_generation` string (`types.ts:453` — declared, no implementation/registration).
- Sweepers run in-process on `setInterval` (no scheduler): `sweepExpiredOrders` (5m), `pruneRevokedTokens` (1d), `reconcileRefunds`, `runWorkers`, `sweepAbandonedCarts` (24h). No queue broker for cross-instance fan-out.

## 17. File Storage / Uploads

**Status: IMPLEMENTED**

- Tenant-partitioned keys `{merchantId}/{id}.{ext}`, `sanitizeKey` path-traversal-safe; write path behind auth + permission; magic-byte sniffing prevents stored-XSS via spoofed extensions; public read serves static images only.
- Local-disk storage adapter (`shared/storage.ts`); **no object-storage (S3) abstraction**: single-node limitation in pool. (`storage.ts` reads key layout; S3 ABSENT.)

## 18. Audit Logging

**Status: PARTIALLY IMPLEMENTED**

- `audit_logs` table + `audit-logs` module exist. **UNVERIFIED**: no evidence gathered that high-value events (login, permission changes, payments, lifecycle transitions) are uniformly written; not all mutating routes cite audit entries.

## 19. Rate Limiting

**Status: IMPLEMENTED** (with a known scope weakness)

- 12 rules, all keys `{ip}:{pathname}` (`rate-limit.ts:19-32, 298`), 60 s window; in-memory store in dev, Redis in prod with startup validation + graceful fallback (`initializeRateLimitStore`).
- **Weakness**: keys are **not merchant-scoped** (a shared NAT IP shares the budget across all tenants on a given path), and not user-scoped. Acceptable as DoS hygiene; not a tenant-isolation defense.
- Login lockouts additionally keyed per-email.

## 20. Observability / Reporting

**Status: PARTIALLY IMPLEMENTED**

- Rollup/report endpoints exist (`overview`, `profit`, `analytics`, `reports`-style modules) — all merchant-scoped.
- **UNVERIFIED**: no evidence of stdout structured-logs correlation IDs or request tracing across modules; no health of pool beyond `health` route. Aggregation is merchant-local (no platform-wide queries — by design).

## 21. Platform Administration

**Status: NOT IMPLEMENTED**

- No platform-admin principal, role, or surface. No tenant (merchant) creation/onboarding route (only `database/seed.ts:222` inserts a merchant), no merchant suspension UI, no plan provisioning, no signup route for merchants (greps: signup, platform-admin, superadmin → 0 routes).
- Lifecycle statuses can only change via direct SQL today.

## 22. Test Coverage & Final Verdict

**Status: PARTIALLY IMPLEMENTED**

- 41 test files, 302/302 passing (incl. 11 merchant-lifecycle tests), 1378 expects; `bunx tsc --noEmit` clean; eslint clean.
- **Coverage gaps**: no cross-tenant isolation tests (outlet/restaurant-scope tests are intra-tenant: branch vs main outlet); no tests in `apps/web` or `apps/storefront`; no billing/entitlement/API-key/platform-admin tests. Query-level isolation is verified by code audit (§3), not by adversarial tests.

### Verdict

Tenant isolation (the thing that would cause a breach if broken) is **strong**: 0 exploitable cross-tenant query paths found, DB re-derivation prevents token-level impersonation, and the enforcement chain is uniform. The SaaS **product** layer is aspirational: no RLS, no platform admin, no billing/subscriptions, no quotas, no entitlement coverage over the core commerce surface, and a lifecycle state machine nobody drives. Graph reflects this: 3045 nodes / 7767 edges / 165 communities; graphify-out regenerated and current.

**Priority follow-ups** (all guarded, none are isolation holes):
1. RLS or equivalent DB-level enforcement (P1).
2. Drive the lifecycle state machine (suspension/trial/past-due transitions + dunning).
3. Cover core commerce routes with `module:` gating.
4. SaaS billing engine per `docs/gap-analysis-saas.md` + `merchant_plans`.
5. Cross-tenant adversarial test suite (the current intra-tenant tests under-test the isolation boundary).