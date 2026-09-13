Fix the following database-layer issues in apps/api/src/database/schema.ts 
and the migration pipeline (Drizzle + PostgreSQL, apps/api/drizzle/). 
Do this as separate, reviewable changes — one concern per migration.

1. ROW LEVEL SECURITY (highest priority)
   - Enable RLS on every tenant-scoped table (all tables with a merchantId 
     column — see schema.ts for the full list).
   - Add a CREATE POLICY per table restricting rows to 
     current_setting('app.current_merchant_id')::varchar = merchant_id.
   - Set app.current_merchant_id via SET LOCAL at the start of each request 
     transaction, from the authenticated user's merchantId — add this to 
     the request middleware/plugin layer (apps/api/src/plugins), not 
     per-query.
   - Do NOT rely on superuser/bypassrls connections for the app's own DB 
     role — create/verify a dedicated app role without BYPASSRLS.
   - Write a migration that adds RLS + policies for all existing tables, 
     and update drizzle.config / schema comments so new tables added later 
     are required to follow the same pattern (add a checklist note in 
     AGENTS.md or CONTRIBUTING).

2. SOFT DELETE for merchants (and ideally for orders/products)
   - Add a deletedAt timestamp (nullable) column to the merchants table.
   - Change all merchantId foreign keys currently using 
     onDelete: 'cascade' to onDelete: 'restrict' (or remove cascade and 
     handle tenant offboarding via an explicit archival job).
   - Implement a "deactivate merchant" flow that sets status + deletedAt 
     instead of deleting the row; add a scheduled/manual hard-delete job 
     for actual GDPR-style erasure requests, run explicitly, not via FK 
     cascade.

3. MISSING INDEXES on merchantId for:
   menuItemModifiers, menuItemOutlets, inventoryLogs, foodOrderItems, 
   driverAssignments, paymentTransactions
   - Add a composite index on (merchantId, <most common filter column>) 
     for each — e.g. paymentTransactions: (merchantId, status), 
     inventoryLogs: (merchantId, createdAt), foodOrderItems: 
     (merchantId, orderId) if not already covered.
   - Generate via drizzle-kit, review the generated SQL before applying.

4. MONEY PRECISION
   - Audit every place in apps/api/src that sums/aggregates money fields 
     in JS after reading numeric columns out of Postgres (mode: 'number').
   - For any aggregation across multiple rows (order totals, refund sums, 
     loyalty ledger, campaign spend), either do the SUM in SQL 
     (Postgres numeric arithmetic, exact) instead of in JS, or switch 
     those specific reads to mode: 'string' and use a decimal library 
     (e.g. decimal.js) for the JS-side math.

5. VERIFICATION
   - After applying RLS, write a test that connects as the app DB role, 
     sets app.current_merchant_id to merchant A, and asserts a query for 
     merchant B's orders/customers/payment_transactions returns zero rows 
     — even with no WHERE merchantId clause in the query itself.
   - Run this test in CI so a future PR can't silently regress tenant 
     isolation back to app-code-only enforcement.

Output: one migration file per numbered item above, plus the RLS 
verification test. Do not touch unrelated schema/business logic.
