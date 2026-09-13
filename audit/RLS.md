Wire the request-scoped tenant DB (auth.db, from apps/api/src/database/tenant-context.ts,
already attached in apps/api/src/plugins/auth.ts) through every service module so RLS
(apps/api/drizzle/0029_enable_rls.sql) actually protects live traffic. Right now RLS is
active in Postgres but all 41 service files still query through the global `db` singleton
(apps/api/src/database/client.ts), which has no app.current_merchant_id set — so every
merchant-scoped query from these files currently returns ZERO rows under RLS, not real
data. This is a correctness break, fix it file by file, not by reverting RLS.

SCOPE — these 41 files (all import `db` from '../../database/client'):
modules/affiliates/service.ts, modules/analytics/service.ts, modules/api-keys/service.ts,
modules/audit-logs/service.ts, modules/campaigns/service.ts, modules/carts/service.ts,
modules/content/service.ts, modules/customer-tags/service.ts, modules/customers/service.ts,
modules/delivery/service.ts, modules/discounts/service.ts, modules/emails/service.ts,
modules/food-orders/service.ts, modules/fulfillments/service.ts, modules/inventory/service.ts,
modules/invoices/service.ts, modules/kitchen/service.ts, modules/loyalty/program.ts,
modules/loyalty/service.ts, modules/menu/service.ts, modules/modules/service.ts,
modules/orders/service.ts, modules/outbound-webhooks/service.ts, modules/outlets/service.ts,
modules/overview/service.ts, modules/procurement/service.ts, modules/production/service.ts,
modules/products/service.ts, modules/profit/service.ts, modules/reviews/service.ts,
modules/roles/service.ts, modules/segments/service.ts, modules/settings/service.ts,
modules/storefront/service.ts, modules/tables/service.ts, modules/theme/service.ts,
modules/user-outlets/service.ts, modules/warehouses/service.ts, modules/webhooks/index.ts
(and each module's routes in index.ts — see pattern below).

PATTERN — apply per module:

1. In service.ts: every exported function that currently closes over the imported
   `db` singleton must instead accept it as a parameter. Add a `DB` type
   (`import type { DB } from '../../database/client'` — this type still works, only
   the runtime singleton usage changes) and make it the function's first parameter:

   BEFORE:
     export const listOrders = async (merchantId: string, ...) => {
       const rows = await db.select().from(orders).where(eq(orders.merchantId, merchantId))
     }

   AFTER:
     export const listOrders = async (db: DB, merchantId: string, ...) => {
       const rows = await db.select().from(orders).where(eq(orders.merchantId, merchantId))
     }

   Do this for every exported function in the file, not just the obvious ones — grep
   the file for `db.` to find all call sites. Keep the merchantId-based WHERE clauses
   as-is (defense in depth — RLS is the backstop, not a replacement for explicit scoping).

2. In each module's index.ts (route definitions): every call site that currently does
   `SomeService.listOrders(auth.merchant.id, ...)` becomes
   `SomeService.listOrders(auth.db, auth.merchant.id, ...)`. `auth.db` already exists on
   context from the derive in plugins/auth.ts — no new import needed there, `auth` is
   already destructured in these route handlers.

3. EXCEPTIONS — do NOT change these to use auth.db, they run before a merchant is known
   or outside the authenticated-request path, and must keep using the global admin-level
   `db` (or explicitly use `withTenantContext`/`beginTenantTransaction` themselves once
   they've resolved which merchant they're acting for):
   - modules/auth/service.ts, modules/customer-auth/* — login/signup look up users by
     email BEFORE merchant is known; these legitimately query across tenants pre-auth.
   - modules/webhooks/index.ts, modules/outbound-webhooks/service.ts — external payment/
     webhook callbacks identify the merchant from the payload/signature, not a JWT; after
     resolving merchantId from the webhook payload, wrap the rest of that handler's DB
     work in `withTenantContext(merchantId, async () => { ... })` from
     database/tenant-context.ts instead of receiving auth.db.
   - any background job / cron / script (check for files outside modules/ under
     src/jobs or similar, and package.json scripts) — these should connect via the
     app_admin role (BYPASSRLS), not app_runtime. Confirm which DATABASE_URL they use.
   Flag any other file where you're unsure whether it runs pre-auth or cross-tenant by
   design, rather than guessing.

4. After each module: run `bunx tsc --noEmit` to confirm no call site was missed (a
   function signature change will surface every stale caller as a type error — use
   that as your checklist, don't rely on grep alone).

5. Do this module by module (one file pair — service.ts + index.ts — per commit/step),
   not all 41 files in one giant diff. Easier to review, easier to bisect if something
   breaks.

VERIFICATION — after all modules are converted:
- `bunx tsc --noEmit` clean across the whole apps/api package.
- Run the existing test suite (`bun test`) — expect real failures to surface here if
  any service function's new `db` param was passed incorrectly, since tests hit real
  seeded data.
- Run test/rls-isolation.test.ts with APP_RUNTIME_DATABASE_URL set (from
  drizzle/0029_manual_role_setup.sql) to confirm the DB-level guarantee still holds.
- Manually smoke-test at least one full request per converted module against a real
  dev DB with RLS enabled (0029_enable_rls.sql applied) — confirm it returns real data,
  not empty results, since empty-results-due-to-missing-auth.db is exactly the silent
  failure mode this migration is meant to catch and fix.

Do not touch schema.ts, the RLS migration, or auth.ts in this pass — those are already
done. This pass is purely: thread auth.db through the 41 service files above.