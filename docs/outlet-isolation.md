# JamiCore Tenant & Outlet Isolation

## Tenancy model

Two-level scoping:

1. **Merchant** — the tenant. Every row that belongs to a business has a
   `merchantId` FK. `resolveMerchantContext` (`shared/merchant-context.ts`)
   derives the merchant from the authenticated principal (staff JWT,
   shopper JWT, or provider webhook slug) and validates module enablement.
2. **Outlet** — an operational unit within a merchant (restaurant branch,
   warehouse-linked location). Access is via the `user_outlets` assignment
   table; owners/admins are implicitly scoped to all outlets.

## Request path

`authPlugin` → `resolveMerchantContext(user, merchant, isAdmin, requestedOutletId)`
where `requestedOutletId` is read from (priority): route param `outletId`,
`x-outlet-id` header, or `outletId` query. Browser-supplied values are validated
against the user's assignments; invalid/out-of-scope outlets are rejected.

## Current coverage

`outletGuard` with `outletRequired` is used by the restaurant-era modules:
food-orders (default-deny list + row-level `assertOrderInScope`), menu,
tables, kitchen, delivery, outlets, roles, user-outlets, modules.

Commerce **orders**, **invoices**, **fulfillments**, **analytics** and the
**overview** dashboard are outlet-scoped via the shared helpers in
`shared/outlet-scope.ts` (`branchScopeOf`, `branchScopeIds`,
`resolveEffectiveScope`, `assertOrderInBranchScope`, `branchOrderCondition`).
The caller's effective scope (`resolveEffectiveScope`) is resolved from, in
order: legacy owner/admin → GLOBAL; assigned role's `roles.scope`; else OUTLET.
GLOBAL/MERCHANT scopes are merchant-wide (`null` filter, like admin); OUTLET is
limited to the `user_outlets` assignments; OWN gets no implicit outlet access
(empty set = default-deny). Branch-staff see online (ecommerce) data plus data
at their assigned outlets (`outletId IS NULL OR outletId IN (assigned)`).
Out-of-scope row reads and writes return 403 `OUTLET_SCOPE`.

- orders: list/export filtered, row-level reads + status/cancel/returns/refunds
  (+ return-approval and refund-retry) asserted.
- invoices: list filtered via order join; get/getByOrder/create asserted.
- fulfillments: list filtered via order join; get/create/update asserted.
- analytics: `sales` (incl. refunds, joined to orders), `products`,
  `customers` (order-derived activity) scoped; `conversion` (visits) stays
  merchant-wide.
- overview: sales/revenue, order counts, sales chart, recent orders and top
  products scoped; stock widgets stay merchant-wide.
- tables: table-sections/tables/table-sessions `list`+`get` filtered to the
  caller's outlets (default-deny); row-level close/cancel/move/merge/split and
  station/table create/update/status/remove asserted via `assertInOutletScope`
  (the `qt` table endpoint stays public QR metadata, no auth).
- kitchen: stations `get`/`update`/`remove` are asserted
  (`assertInOutletScopeOrShared` — General/merchant-wide stations keep working
  for any scoped caller, but outlet-owned stations are still enforced); tickets
  `list`/`get`/board and KOT writes (generate/transition/bump/recall/priority/
  item-status) are default-deny filtered to outlet-owned tickets.
- delivery: zones `list`/`get` and row writes asserted
  (`assertInOutletScopeOrShared`, shared/null-outlet zones stay merchant-wide);
  delivery orders `list` scoped (`outletId IS NULL OR outletId IN (scope)`),
  get/create/assign/dispatch/unassign/status asserted; drivers stay a
  merchant-wide shared pool for reads, but driver create/update/remove/status
  validate `assignedOutletId` against scope.
- menu: catalog (`list`/`get`/modifier-groups) is merchant-wide by design
  (`menuItems` and modifier tables carry no `outletId` — a shared catalog with
  per-outlet availability overrides in `menuItemOutlets`); the per-outlet write
  surface `setOutletRule` (`POST /menu/:id/outlets`) asserts the target outlet
  is in scope.

Products, inventory, customers, discounts, campaigns and warehouses carry no
`outletId` and are **merchant-wide shared entities by design** — there is no
per-outlet row to leak, so no outlet filter applies (catalog/customer/settings
data is common to every branch).

Procurement (suppliers, purchase orders, goods receipts) declared **merchant-wide
by design** at introduction (consistent with products/warehouses/inventory): the
tables carry no `outletId`, so the procurement module needs no outlet guard —
merchant-wide read/write gated only by `inventory.read` / `inventory.manage`.

**Gap**: every restaurant-era `list` read is now default-deny outlet-scoped or
an explicit merchant-wide entity. The remaining decision points are documented
in "Planned evolution" (delivery driver pool and menu catalog are merchant-wide
by design, with their per-outlet write surfaces already asserted).

## Planned evolution

- Confirm remaining restaurant-era semantics with product: menu sales/
  availability reporting by outlet (merchant-wide catalog, so outlet-gated
  *reporting* is a future analytics concern, not a row-isolation one).
- Every new domain (production/BOM, recipes, stock counts)
  must declare its outlet/merchant scope when introduced.
- Default-deny for outlet-required operations; merchant-wide operations stay
  merchant-scoped.

## Validation rules

1. Body/header/query `outletId` is a hint, never authority.
2. Any operation touched by an outlet must verify the user → merchant →
   allowed-outlet chain.
3. Unauthorized or out-of-scope access returns 403, never an empty-but-valid
   "all outlets" result for outlet-required operations.