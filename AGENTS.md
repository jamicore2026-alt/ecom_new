# AGENTS.md — Project Memory

> Audit date: 2026-08-24 · HEAD: `b6f239a` (Phase 1 committed) + Phase-2 + full security/audit-hardening batch (all uncommitted)
> Verified state after audit batch: tests 98/98 pass (12 files; +2 guest-claim tests) · typecheck pass · svelte-check 0 errors (71 pre-existing a11y warnings)
> NOTE: migration `0010_audit-hardening` added `customers.token_version`, `orders.coupon_code`, `orders.attribution_channel` — run `bun run db:migrate`. Seed now counts only collected revenue toward customer totalSpent.
> NOTE: migration `0011_variant_clock_timestamp` switches `product_variants.created_at` default to `clock_timestamp()` — batch-inserted variants previously shared one `now()` stamp, so `ORDER BY created_at` ties were nondeterministic across databases (broke the CSV round-trip test in CI only).
> NOTE: staff passwords now require ≥10 chars (bcrypt 12); shopper register on a guest email requires a recent order number as proof (`CLAIM_ORDER_REQUIRED` / `CLAIM_ORDER_MISMATCH`). Rate limiting is active per-IP in dev/prod but skipped when NODE_ENV=test.
> NOTE: migration `0015_audit_logs` added the `audit_logs` table (merchant-scoped activity trail). Run `bun run db:migrate`. Noted 2026-08-28.
> NOTE: migration `0016_tense_garia` added Phase 1 foundation tables — `outlets`, `merchant_modules`, `roles`, `user_outlets` (normalized, all merchant-scoped, `user_outlets` cascade on user/outlet delete). Run `bun run db:migrate` + `db:seed` (seed is idempotent; reseeding is required for a fresh merchant to get its default outlet/modules/roles). Noted 2026-08-28.
> NOTE: migration `0019_blue_groot.sql` added Phase 5 dine-in tables — `table_sections`, `tables`, `table_sessions`, plus `orders.tableSessionId`. Run `bun run db:migrate` + `db:seed` (seed now also creates a `Main Floor` section with 8 tables, each with a QR token). Noted 2026-08-28.
> NOTE: migration `0020_round_union_jack.sql` added Phase 6 kitchen/KOT/KDS — `kitchen_stations`, `kitchen_tickets` (unique order+station → guards dup KOT), `kitchen_ticket_items`. Run `bun run db:migrate` + `db:seed` (seed now also creates 5 stations: Grill/Fryer/Drinks/Dessert/General). `seedModules` includes `'kitchen'`; `seed` `TRUNCATE` does NOT list `kitchen_stations` (CASCADE from orders clears tickets), so re-running seed's station block is guarded by a per-name existence check to stay idempotent. Test-created tickets/stations persist across runs (kitchen test uses a per-run-unique station name). Noted 2026-08-28.
> NOTE: migration `0021_cultured_chameleon.sql` added Phase 7 delivery — `delivery_zones`, `drivers`, `delivery_orders`, `driver_assignments`, `driver_locations`. Run `bun run db:migrate` + `db:seed` (seed now also creates 1 Downtown zone + 1 driver, Dana Driver, `driver@acme.com`). `seedModules` includes `'delivery'`. Noted 2026-08-29.

## Phase 1 — Outlets, modules, RBAC foundation (2026-08-28)

- **Shared types** (`src/shared/types.ts`): expanded `Permission` (added granular `orders.*`, `products.*`, `menu.*`, `kitchen.*`, `kds.*`, `tables.*`, `delivery.*`, `drivers.*`, `inventory.*`, `payments.*`, `reports.*`, `staff.*`, `customers.*`, `settings.*`; legacy `products:write` etc. kept for backward compat). Added `SCOPES = GLOBAL|MERCHANT|OUTLET|OWN`, `MODULES` catalog (commerce, restaurant, pos, kitchen, tables, delivery, inventory, marketing, analytics), `DEFAULT_MODULES`, `DEFAULT_ROLES` (12 roles, all `isSystem: true`), `OUTLET_STATUSES`.
- **Schema** (`src/database/schema.ts`): `outlets` (merchant+code unique), `merchant_modules` (merchant+module unique), `roles` (merchant+name unique, `permissions` jsonb, `scope`, `isSystem`), `user_outlets` (user+outlet unique, cascade deletes). Row types exported.
- **Merchant context** (`src/shared/merchant-context.ts`): `resolveMerchantContext(userId, merchantId, isAdminUser, requestedOutletId?)` → `{ allowedOutlets, selectedOutlet, enabledModules }`. `allowedOutlets` come ONLY from `user_outlets` join (owner/admin with no explicit assignment default to all merchant outlets); `selectedOutlet` is always re-validated against allowed outlets — browser-supplied outletId is never trusted.
- **Guard** (`src/plugins/outlet.ts`): `outletGuard({ outletRequired?, permissions?, module? })` composes with `authPlugin` — enforces auth → module enabled (403) → outlet scope (403 if `outletRequired` and none resolves) → `hasPermission`; attaches `merchantContext` to context. `requestedOutletId` derives from `outletId` param, then `x-outlet-id` header, then `outletId` query.
- **API modules** (registered in `app.ts`): `modules/outlets` (list/my/get/create/update/archive; writes + `staff.manage`), `modules/modules` (list catalog with `enabled`/`locked` flags, toggle `PUT /modules/:module`, `settings.manage`), `modules/roles` (CRUD; system roles immutable → 400 `IMMUTABLE_ROLE`, name conflict → 409; `staff.manage`), `modules/user-outlets` (list + replace assignments `PUT /user-outlets/:userId`, `staff.manage`). Writes fire `auditFromRequest`.
- **`/me` payload** now includes `allowedOutlets[]`, `selectedOutlet`, `enabledModules` (via `AuthService.session` → `resolveMerchantContext`).
- **Web** (`apps/web`): `api.ts` reads persisted selected outlet (`md.outlet`) and sends `x-outlet-id` on every authed request; `session.svelte.ts` tracks `allowedOutlets`/`enabledModules`/`selectedOutlet` (validated against server response) + `switchOutlet()`; sidebar adds an outlet selector when a user has >1 outlet.
- **Seed**: every merchant gets one `Main Outlet` (code MAIN), `DEFAULT_MODULES.commerce` modules, all `DEFAULT_ROLES` as system roles, and owner+admin assigned to the main outlet.
- **Tests** (`test/outlets.test.ts`): outlets CRUD + dedupe, modules catalog/toggle/unknown, roles CRUD + system-role immutability, user-outlet assignment, and staff 403 guards. **Not run** — Postgres unavailable in this env (see below).

### Phase 1 verification status
- `bun run typecheck` (api): PASS · `bun run check` (web+storefront): 0 errors (71 pre-existing a11y warnings)
- DB verified: `db:migrate` + `db:seed` succeeded against local PostgreSQL; seeded 12 system roles, 1 Main Outlet, 4 modules. `bun test`: **123 pass / 0 fail** across 15 files (incl. new `test/outlets.test.ts`).
- Gotcha found: Elysia dedupes plugins by `name`, so two `.use(outletGuard(...))` with the same name silently drop the second — `plugins/outlet.ts` keys the instance name on options (`outlet-guard:<mods>:<perms>:<outletRequired>`).

## Phase 2 — Dynamic dashboard (2026-08-28)

- **Centralized nav metadata** (`apps/web/src/lib/navigation.ts`): `NAV_ITEMS` (`{ label, route, icon, group, module?, permission? }`) + `NAV_ICONS`. Items are grouped (General/Sell/Insights) and gated by an optional `module` (must be enabled for the merchant) and/or `permission` (single or any-of array). This is the single source for the shell; future phases (restaurant/delivery/kitchen/pos) add entries here keyed to their modules. Mapping of existing routes: Products/Orders/Customers/Reviews → `commerce`; Inventory → `inventory`; Discounts → `marketing`; Analytics → `analytics`; Overview/Audit/Settings → core (no module).
- **`session.visibleNav`** (`apps/web/src/lib/session.svelte.ts`): reactive `$derived.by` that filters `NAV_ITEMS` by `enabledModules` + permissions (owner/admin bypass via role; others any-of matches). Frontend hiding is UX only — every API route still enforces auth/permission/outlet/module server-side.
- **`(app)/+layout.svelte`**: sidebar now renders grouped, permission/module-aware navigation from `session.visibleNav` instead of a hardcoded array (outlet selector from Phase 1 retained). Flicker-free: nav derivation is reactive to `enabledModules`/`user`.
- **Verification**: `bun run check` (web+storefront): 0 errors, 71 pre-existing a11y warnings. `bun run typecheck` (api): PASS. `bun test`: **123 pass / 0 fail** (no API changes in this phase).
- **Consideration / not done in Phase 2**: true server-side module-gating of every legacy commerce route is intentionally NOT added (would risk audited flows and isn't this phase's deliverable). Disabled-module nav is hidden client-side; authorization remains enforced by the existing `authPlugin`/`requirePermission`/`outletGuard` guards.

## Phase 3 — Food menu (2026-08-28)

- **Schema** (migration `0017_cheerful_stellaris`): 5 tables layered over the existing catalog (categories/products/variants are reused, NOT duplicated):
  - `menu_items` — food metadata for a bound product: `productId` (cascade FK, unique per merchant+product), `available`, `preparationTimeMin`, `kitchenStation`, `dietaryTags` jsonb, `allergens` jsonb, `taxRate` numeric(6,3), `sortOrder`, `status`, `availability` jsonb (weekly time windows `[{days:[0-6],start:"09:00",end:"22:00"}]`, empty=always), timestamps.
  - `modifier_groups` — `name`, `required`, `minSelections`, `maxSelections`, `sortOrder`, `status`.
  - `modifiers` — `modifierGroupId` (cascade), `name`, `priceAdjustment` money(12,3), `available`, `sortOrder`, `status`.
  - `menu_item_modifiers` — bind a modifier group to a menu item (unique item+group).
  - `menu_item_outlets` — per-outlet rule: `outletId` (cascade), `available`, `priceAdjustment`; unique item+outlet.
- **API module** (`modules/menu/{index,service,model}.ts`, registered in `app.ts`): reads gated by `outletGuard({ module:'restaurant', permissions:['menu.read'] })`; writes by `module:'restaurant'` + `permissions:['menu.manage']` (disabled module → 403). Routes: GET `/menu` (list, search on product name, join product), GET `/menu/:id` (detail w/ modifierGroups + outletRules), POST/PUT/DELETE `/menu` (+ archive on delete), POST `/menu/:id/modifiers` (bind group), DELETE `/menu/:id/modifiers/:groupId` (unbind), POST `/menu/:id/outlets` (upsert outlet rule), CRUD `/modifier-groups` + `/modifier-groups/:id/modifiers` + `/modifiers/:id`. Writes fire `auditFromRequest`.
- **Seed**: now also enables the `restaurant` module; seeds 6 menu items (from first products), 2 modifier groups (Add Ons optional / Dipping Sauce required) w/ modifiers, item→group bindings, and a Main-Outlet rule.
- **Dashboard**: `Menu` nav item (utensils icon, new `Restaurant` group) gated `module:'restaurant'`+`menu.read`; `/menu` page lists items/price/station/prep/tags/availability, Actions add-from-product modal, show/hide, remove; modifier-groups grid. Added `/menu` to `hooks.server.ts` PROTECTED_PREFIXES. New `MenuItem`/`MenuModifierGroup`/`MenuProductLite` types in `web/src/lib/types.ts`.
- **Verification**: `bun run typecheck` (api) PASS · `bun run check` (web+storefront): 0 errors, 71 pre-existing a11y warnings · `db:migrate` applied `0017` · `db:seed` seeds 6 menu items + 2 groups · `bun test`: **130 pass / 0 fail** across 16 files (new `test/menu.test.ts`, 7 tests).
- **Test gotcha**: menu_test creates + archives a menu item but the row lingers (unique merchant+product holds even when archived). `GET /api/menu` returns archived items, so a re-run with a dirty DB still picks an unlisted product. Reseed before running to avoid stale `MENU_ITEM_EXISTS` 409s in CI/scripts.

## Phase 4 — Unified food orders (2026-08-28)

Extends the existing `orders` model rather than forking it (per plan §8). One order table for all order kinds; a validated state machine replaces ad-hoc status writes.

- **Constants** (`src/shared/types.ts`): `ORDER_TYPES` (`ecommerce`, `DINE_IN`, `TAKEAWAY`, `DELIVERY`, `QR`, `POS`, `SCHEDULED`), `FOOD_ORDER_TYPES`, `FOOD_ORDER_STATUSES` (`CREATED→CONFIRMED→PREPARING→READY→COMPLETED`, `CANCELLED`), `FOOD_STATUS_TRANSITIONS` (valid next-state map per current status), `FoodOrderModifier` snapshot type.
- **State machine** (`src/shared/order-state.ts`): `assertOrderTransition(current, next, orderType)` — food orders must move along the food lifecycle (invalid jump → 409 `INVALID_TRANSITION`); ecommerce orders reject food statuses (400). Food statuses are enforced per order type; raw status assignment is disallowed for food orders.
- **Schema** (migration `0018_graceful_blackheart`): `orders` gains `orderType` (default `ecommerce`), `outletId` (nullable FK→outlets), `scheduledFor` (+ composite merchant/type/status index, outlet index). New `food_order_items` table (FK→orders cascade) holding menu lines: `menuItemId`/`productId`/`variantId` (set-null FKs), `name`, `modifiers` jsonb snapshot, `unitPrice`, `quantity`, `total`.
- **API module** (`modules/food-orders/{index,service,model}.ts`): gated by `restaurant` module — reads `orders.read`, create `orders.create`, update/status/cancel `orders.update`. Routes: GET `/food-orders` (filters type/status/outlet/search, excludes ecommerce, joins outlet name), GET `/food-orders/:id` (detail w/ items), POST `/food-orders` (validates outlet + active menu items + modifiers-of-item + availability, computes unit price = product price + Σ modifier adjustments, tax from menu `taxRate`, totals), PUT `/food-orders/:id` (replace items / notes / schedule while CREATED..PREPARING; locked once COMPLETED/CANCELLED), POST `/food-orders/:id/status` (validated transition), POST `/food-orders/:id/cancel`. Transactions used for create/update; writes fire `auditFromRequest`. Order numbers `#F…`.
- **Dashboard**: `Food Orders` nav item (receipt icon, `Restaurant` group, gated `restaurant` + `orders.read/create`) + `/food-orders` page (type/status filters, list joins outlet, click-row detail modal with items/modifiers/notes, "Mark <next>" validated advance button + Cancel for CREATED/CONFIRMED, New-order modal with outlet + item picker + qty + a modifier). Added `/food-orders` to `hooks.server.ts` prefixes. New `FoodOrder`/`FoodOrderLine`/`FoodOrderModifierSnapshot` types in `web/src/lib/types.ts`.
- **Verification**: `bun run typecheck` (api) PASS · `bun run check` (web+storefront): 0 errors, 71 pre-existing a11y warnings · `db:migrate` applied `0018` · `bun test`: **138 pass / 0 fail** across 17 files (new `test/food-orders.test.ts`, 8 tests).
- **Fixes along the way**: state-machine map is keyed by **current** status (indexed the wrong way initially — `FOOD_STATUS_TRANSITIONS[current]` must contain `next`); food-order test now picks an available+active menu item (Phase-3 test debris had archived one); module-array spread in seed typed `ModuleId[]` to satisfy tsc widening.

## Audit-hardening batch (2026-08-24) — what changed and why

**Security**
- JWT secrets validated at boot in production (`resolveSecret` fails fast on missing/dev defaults).
- Refresh rotation is atomic: `claimRefreshToken` inserts blacklist row with ON CONFLICT DO NOTHING — replayed refresh tokens lose the race safely. Blacklist pruning moved off the request path into a background interval in `index.ts`.
- Staff login anti-enumeration via DUMMY_HASH compare for unknown emails; AMBIGUOUS_LOGIN only fires when the password actually matches multiple accounts.
- H1 fixed: all customer reads use `publicCustomerColumns` (password_hash never leaves the DB): customers list/get/orders, order detail, analytics topSpenders.
- Shopper sessions: tokens carry `tv` = `customers.tokenVersion`; password change bumps it (kills old tokens) and returns a fresh token. TTL via env `SHOPPER_TOKEN_TTL` (default 7 days, was hardcoded 30d). Guest-claim requires order-number proof.
- Tamara webhooks REQUIRE a valid signed tamara_token whenever notificationToken is configured (timing-safe verify); `/sync` resolves the latest payment_transactions row server-side and passes providerRef to adapters.
- Uploads sniff magic bytes (jpg/png/webp/gif) before saving; public file route sends `x-content-type-options: nosniff` + sanitized content-disposition.
- CSV escape neutralizes formula injection (leading `=+-@` gets `'` prefix); ILIKE search escapes `%_\`; pagination page cap 1000; body limit 8MB; swagger disabled outside dev.
- Rate limiter (`shared/rate-limit.ts`): login/register 10/min, checkout 30/min, events 60/min, webhooks 240/min, in-memory sliding window keyed ip+path. Skipped under NODE_ENV=test.

**Money/inventory correctness**
- `applyPaymentResult` fully transactional: underpay guard (amount < txn −0.005 stays pending), currency mismatch guard, conditional unpaid→paid flip with RETURNING, relative SQL increments for customer totals, visits.paid upsert by channel. Manual "mark paid" goes through shared `applyManualMarkPaid` (`shared/order-payments.ts`) with the same invariants.
- Payment-status transitions enforced (`PAYMENT_TRANSITIONS`: unpaid→[paid,failed], paid→partially_refunded→refunded); fulfillment blocked on cancelled/refunded orders.
- Sweeper/cancel share `cancelPendingOrder`: transactional conditional claim, FOR UPDATE restock, coupon quota restore, reason 'cancel'. Cancel subtracts approved-return quantities (no double restock). Inventory adjust wraps read-modify-write in a tx with FOR UPDATE.
- Coupons: percentage value must be 1–100 at create/update; discount clamped to subtotal and rounded via roundForCurrency; usage-limit increment is conditional inside the order tx (race-safe), restore uses greatest(usedCount−1, 0).
- Provider callbacks: MyFatoorah returns paid amount+currency, 401→PROVIDER_AUTH_FAILED; both adapters use 15s AbortSignal timeouts; failed provider session cancels the pending order immediately; webhook apply-failure deletes its dedupe row so provider retries aren't swallowed.

**Consistency**
- Order numbers gain CSPRNG suffix (#W…+8 random chars) — public payload dropped billingAddress (shippingAddress+notes remain public by design).
- Preview accepts shippingAddress.country so quoted shipping/tax match the final order; storefront re-previews on country change and refuses non-https gateway redirects.
- Overview/analytics day buckets are UTC (`at time zone 'UTC'`); overview currency comes from the merchant row (was hardcoded USD); lowPerformers respects the selected range + revenue statuses; parseRange swaps inverted ranges; bulk price multiply rounds to 3dp.
- Funnel events channel allowlist (direct|organic|social|paid|email|referral, else 'direct'); storefront track() derives channel from utm_medium/referrer.
- Checkout model hardened: email format validation, items maxItems 50, address field maxLengths, notes ≤2000.

## Phase 5 — Tables + QR (2026-08-28)

Dine-in floor management: sections, tables with per-table QR, open/close sessions, move/merge/split, and a public no-auth QR menu context. Builds on the Phase-4 unified orders (a food order can be attached to a table session via `orders.tableSessionId`).

- **Constants** (`src/shared/types.ts`): `TABLE_STATES` (AVAILABLE, RESERVED, OCCUPIED, ORDERING, DINING, BILL_REQUESTED, PAYMENT_PENDING, CLEANING), `TABLE_STATUS_TRANSITIONS` (keyed by CURRENT state), `TABLE_SESSION_STATUSES` (OPEN/CLOSED/CANCELLED) + `TABLE_SESSION_TRANSITIONS`.
- **State helpers** (`src/shared/table-state.ts`): `isTableState`, `isSessionStatus`, `assertTableTransition` (invalid next state → 409 `INVALID_TRANSITION`, unknown state → 400), `assertSessionTransition`.
- **Schema** (migration `0019_blue_groot.sql`): `table_sections` (unique merchant/outlet/name), `tables` (unique merchant/outlet/code, unique `qrToken` random), `table_sessions` (tableId set-null FK, status, guests, openedAt/closedAt), plus `orders.tableSessionId` (set-null FK→table_sessions). `TRUNCATE` in seed does NOT include these (CASCADE), so test-created rows persist across runs — tables tests use per-run-unique names/codes + a `freeTables()` beforeEach helper (closes OPEN sessions, restores AVAILABLE).
- **API module** (`modules/tables/{index,service,model}.ts`): guarded `tablesModule` — reads `outletGuard({module:'tables',permissions:['tables.read']})`, writes `['tables.manage']` (staff lacks manage → 403). Routes: section CRUD, table CRUD (list joins section + open session + orderCount/total), table status, session open/close/cancel, session move (reassigns orders.outletId), merge (sums guests, reassigns orders), split (new session, returns `{session, splitInto}`), attach order to session, GET `/tables/:id/qr`. Public `tableQrModule` registered UNGUARDED: GET `/api/table-qr/:token` → `TableQrService.context(token)` returns table + outlet + public menu items w/ outlet priceAdjustment — NO private merchant data. Guarded module registered AFTER public one in `app.ts`.
- **Seed**: `seedModules` now includes `'tables'`; seeds a `Main Floor` section + 8 tables (T01–T04, Bar 1–2, Patio 1–2), each with a random `qrToken`.
- **food-orders service**: `ORDER_COLUMNS` now includes `orders.tableSessionId` so order detail returns the attached session.
- **Dashboard**: `Tables` nav item (`layout` icon, Restaurant group, `module:'restaurant'`+`tables.read`) + `/tables` page (floor grouped by section, status-chip tone map, seat-guests modal, open session panel w/ close/cancel, move-to-free-table, per-table QR url display, manage-floor modal to add section/table). Added `/tables` to `hooks.server.ts`. New `TableSection`/`DiningTable`/`OpenSession`/`TableSession`/`TableQrContextItem`/`TableState` types in `web/src/lib/types.ts`.
- **Verification**: `bun run typecheck` (api) PASS · `bun run check` (web+storefront): 0 errors, 71 pre-existing a11y warnings · `bun test`: **147 pass / 0 fail** across 18 files (new `test/tables.test.ts`, 9 tests).

## Phase 6 — Kitchen + KOT + KDS (2026-08-28)

Kitchen stations, Kitchen Order Tickets (KOT), and a live Kitchen Display System (KDS) board, built on the Phase-4 unified food orders (a KOT is generated from a food order's items, routed by each menu item's `kitchenStation`).

- **Constants** (`src/shared/types.ts`): `KITCHEN_STATION_STATUSES` (active/inactive/archived), `KITCHEN_PRIORITIES` (LOW/NORMAL/HIGH), `KOT_STATUSES` + `KOT_STATUS_TRANSITIONS` (NEW→ACCEPTED/RECALLED/CANCELLED; ACCEPTED→PREPARING/RECALLED/CANCELLED; PREPARING→READY/RECALLED/CANCELLED; READY terminal; RECALLED→NEW/ACCEPTED/PREPARING/CANCELLED; CANCELLED terminal), `KITCHEN_ITEM_STATUSES` (PENDING/READY/DONE/CANCELLED). NOTE: `MODULES` has **no** `kds` module — KDS is gated under module `'kitchen'` with `kds.read`/`kds.manage` permissions.
- **State helpers** (`src/shared/kitchen-state.ts`): `isKotStatus`, `isKitchenItemStatus`, `assertKotTransition` (unknown → 400 `INVALID_KOT_STATUS`, invalid jump → 409 `INVALID_TRANSITION`).
- **Schema** (migration `0020_round_union_jack.sql`): `kitchen_stations` (unique merchant/outlet/name, `prepSlaMin`), `kitchen_tickets` (NOT NULL `stationId` FK→kitchen_stations cascade, **unique (orderId, stationId) index → guards duplicate KOT**, `sourceType`, `status`, `priority`, `prepSlaMin`, `dueAt`, `receivedAt`, `startedAt`, `readyAt`, `closedAt`), `kitchen_ticket_items` (ticketId FK cascade, orderItemId/menuItemId set-null FKs, `modifiers` jsonb `FoodOrderModifier[]`, `status`, `readyAt`).
- **API module** (`modules/kitchen/{index,service,model}.ts`, registered in `app.ts`): read side gated `module:'kitchen'` + `['kitchen.read']` (stations list/get, tickets list/get, KDS board); station writes gated `['kitchen.manage']` (POST/PUT/DELETE); ticket actions gated `['kitchen.manage','kds.manage']` (**any-of** → kitchen staff can work the board). Routes: `/kitchen-stations` CRUD, `/kitchen/tickets` list (filters outlet/station/status/orderId/search, paginated), `/kitchen/tickets/:id` (detail w/ items), `/kitchen/orders/:id/tickets` (POST generate — idempotent per (order,station), routes items by `menuItem.kitchenStation`, auto-creates missing stations incl. `General` fallback), POST `/kitchen/tickets/:id/status|bump|recall`, PUT `/kitchen/tickets/:id/priority`, POST `/kitchen/tickets/:id/items/:itemId/status` (item-level completion: when all non-done items are READY/DONE and the ticket isn't yet READY → auto-bumps to READY), `/kitchen/kds` (board grouping open tickets by station, `addMeta` ageSec/delayed, `delayedCount`). All writes fire `auditFromRequest`. **Known constraint**: item-level auto-bump calls `transition(READY)` which requires a valid jump — so finishing all items on a still-NEW ticket 409s; workflow is Accept → Start → items done (realistic KDS usage). Station delete is blocked (`409 STATION_BUSY`) while it has open tickets.
- **Seed**: `seedModules` now includes `'kitchen'`; seeds 5 stations (Grill 12, Fryer 10, Drinks 4, Dessert 8, General 10, sortOrder 0–4) with a per-name existence check for idempotency. `TRUNCATE` now cascades to `kitchen_tickets`/`kitchen_ticket_items` via orders.
- **Dashboard**: `Kitchen` (`flame` icon, `Restaurant` group, `module:'kitchen'`+`kitchen.read`) and `KDS` (`monitor` icon, `Restaurant` group, `module:'kitchen'`+`kds.read`) nav items; `/kitchen` page (station cards + manage-station modal add/pause/remove, ticket list with status/station filters, ticket detail modal Accept/Start/Cancel + priority) and `/kds` page (live board grouped by station with per-ticket timer, delayed highlight, priority, Accept/Start/Ready/Recall, item-level Done — auto-refreshes age every second). Both added to `hooks.server.ts` prefixes. New `KitchenStation`/`KitchenTicket`/`KotItem`/`KdsBoard`/`KdsTicket`/`KdsItem`/status-union types in `web/src/lib/types.ts`. The shared `Badge` component takes only `{label}` with a fixed tone map — kitchen pages use inline spans for custom status chips.
- **Verification**: `bun run typecheck` (api) PASS · `bun run check` (web+storefront): 0 errors, 71 pre-existing a11y warnings · `bun test`: **157 pass / 0 fail** across 19 files (new `test/kitchen.test.ts`, 10 tests).
- **Test gotchas**: (1) the KOT generate POST route requires a JSON body `{}` (body schema `kotGenerateBody`) — omit and Elysia 400s. (2) `/kitchen/tickets` list returns tickets with `itemCount` only (no nested items); nested `items` come from `get`/`generate`'s full shape — tests fetch detail for item ids. (3) `outlets.test.ts` module-toggle test turns the `kitchen` module OFF to "restore" it (stale — seed now enables kitchen), and Bun runs test files in parallel processes sharing one DB, so kitchen.test's `beforeAll` explicitly PUTs `/api/modules/kitchen` `{enabled:true}` first to stay isolated.

## Phase 7 — Delivery + drivers (2026-08-29)

Delivery zones, driver dispatch, and a per-delivery lifecycle on top of Phase-4 orders. Builds on the unified `orders` model (a `DELIVERY`-type food order becomes a tracked delivery).

- **Constants** (`src/shared/types.ts`): `DELIVERY_ZONE_STATUSES` (active/inactive), `DELIVERY_STATUSES` (UNASSIGNED→ASSIGNED→ARRIVED_AT_PICKUP→PICKED_UP→IN_TRANSIT→ARRIVED→DELIVERED, plus FAILED/CANCELLED), `DELIVERY_STATUS_TRANSITIONS` (keyed by current; rear stages terminal), `DRIVER_STATUSES` (OFFLINE/ONLINE/BUSY/PAUSED/SUSPENDED) + `DRIVER_STATUS_TRANSITIONS`.
- **State helpers** (`src/shared/delivery-state.ts`): `isDeliveryStatus`/`isDriverStatus`, `assertDeliveryTransition` (unknown → 400 `INVALID_DELIVERY_STATUS`, bad jump → 409 `INVALID_TRANSITION`), `assertDriverTransition`.
- **Schema** (migration `0021_cultured_chameleon.sql`): `delivery_zones` (unique merchant/outlet/name, center lat/lng + radiusKm, deliveryFee, minOrder, freeDeliveryThreshold, etaMin), `drivers` (unique merchant+userId, NOT NULL userId FK→users with `onDelete set null` — contradictory combo, see gotcha), `delivery_orders` (one per order via unique orderId, status, assignedDriverId, address jsonb, fee, etaMin, timestamps), `driver_assignments` (history log), `driver_locations` (heartbeat). `driver_locations.user_id` NOT NULL.
- **API module** (`modules/delivery/{index,service,model}.ts`, registered in `app.ts`): `deliveryModule` — reads `outletGuard({module:'delivery', permissions:['delivery.read','drivers.read']})` (zones list/get, drivers list/get, deliveries list/get); zone writes `['delivery.manage']` (CRUD); driver writes `['drivers.manage']` (CRUD + `POST /drivers/:id/status` **driver-status enum** — not delivery enum); delivery create/assign/dispatch/unassign/status `['delivery.assign']`. `driverSelfModule` (registered after) — driver self-service under `['delivery.read']`: GET/PUT `/delivery/me`, `POST /delivery/me/location`, `GET /delivery/me/orders`. All writes fire `auditFromRequest`. `delivery_orders` created from an existing `DELIVERY` order; dispatch picks the first online eligible driver (correct outlet), assign marks driver BUSY, complete/unassign frees to ONLINE.
- **Seed**: `seedModules` now includes `'delivery'`; seeds 1 zone (Downtown) + 1 driver (Dana Driver, `driver@acme.com`, role `driver`) with idempotent per-name/existence checks. `TRUNCATE` cascades to delivery tables via orders/users.
- **Dashboard**: `Delivery` (`bike` icon, `Restaurant` group, `module:'delivery'`+`delivery.read`) nav item + `/delivery` page (zones CRUD + drivers status toggle + live delivery list w/ status advance/dispatch/assign/unassign, driver self-service panel). Added `/delivery` to `hooks.server.ts`. New `DeliveryZone`/`Driver`/`DeliveryOrder`/types in `web/src/lib/types.ts`.
- **Verification**: `bun run typecheck` (api) PASS · `bun run check` (web+storefront): 0 errors, 71 pre-existing a11y warnings · `bun test`: **166 pass / 0 fail** across 20 files (new `test/delivery.test.ts`, 9 tests).
- **Gotchas / fixes along the way**: (1) `drivers.user_id` is `.notNull()` **and** has `onDelete:'set null'` — contradictory, so deleting a driver user blows up with not-null violation. Test afterAll must delete the `drivers` row before the `users` row. (2) `POST /drivers/:id/status` was initially validated with the **delivery**-status enum body, so sending a valid driver status (OFFLINE/ONLINE/PAUSED…) returned 400 — fixed with a dedicated `driverTransitionBody`. (3) `createDriver` in the test must set a real `merchantId` (not null) and grant `['delivery.read','drivers.read']` for driver self-service to authorize.

Multi-tenant e-commerce monorepo (**Turborepo + Bun**, packageManager `bun@1.3.14`). Three apps, no packages/ yet.

| App | Stack | Port | Notes |
|---|---|---|---|
| `apps/api` | ElysiaJS + Drizzle ORM + PostgreSQL | 3005 | Swagger at `/docs`. TypeBox validation via drizzle-typebox |
| `apps/web` | SvelteKit 2 + Svelte 5 (runes) + Tailwind v4 | 5478 | Merchant dashboard. Client-rendered (`onMount` fetches, no load fns) |
| `apps/storefront` | SvelteKit 2 + Svelte 5 + Tailwind v4 | 5479 | Public storefront, SSR load functions, multi-store via `/[slug]` |

Both SvelteKit apps proxy `/api → http://localhost:3005` in dev (`vite.config.ts`, strictPort). Storefront home `/` redirects to `/{PUBLIC_DEFAULT_STORE}` = `acme-store`.

## Production topology (Coolify, 2026-08-25)
Three services + Postgres: API `api.jamicore.com`, dashboard `merchant.jamicore.com`, storefront `store.jamicore.com`. Both frontends ship a same-origin reverse proxy (`src/routes/api/[...path]` + `uploads/[...path]` → `lib/server/api-proxy.ts`, runtime env `API_ORIGIN`, default localhost:3005) so browsers never talk cross-origin to the API — no CORS/cookie issues, hooks guard keeps working. Storefront `PUBLIC_*` vars are build-time Dockerfile ARGs (baked); `API_ORIGIN` is runtime. All three have Dockerfiles (build context = repo root: `docker build -f apps/<app>/Dockerfile .`). Mount a volume at `/app/apps/api/uploads` on the API container or uploaded images are lost on redeploy. Run `bun run db:migrate` as a Coolify pre-deploy command (devDeps incl. drizzle-kit stay in the image for this). Swagger auto-disabled when NODE_ENV=production.

## Commands

```bash
bun run dev                # all apps
bun run dev:api|dev:web|dev:storefront
bun run test               # bun test (api only — 4 files: smoke, storefront, checkout, payments)
bun run typecheck          # tsc --noEmit (api only)
bun run check              # svelte-check (web + storefront)
bun run db:migrate && bun run db:seed   # seed idempotent
docker compose up -d       # postgres:18-alpine :5432 (needs sudo on this machine)
```

Seed admin login: `admin@acme.com` / `password123` (merchant slug `acme-store`).
Env: copy `.env.example` → `.env` (root) **and** `apps/api/.env`. Secrets are JWT_ACCESS_SECRET/JWT_REFRESH_SECRET/DATABASE_URL/PORT; turbo `globalEnv` tracks these for cache keys.
CI (`.github/workflows/ci.yml`): bun 1.3.14 + node 22, postgres:16 service → install --frozen-lockfile → typecheck → check → migrate+seed+test → build.

## API architecture (apps/api)

- Bootstrap chain in `src/app.ts`: onError → cors(origin /.*) → swagger(/docs) → 11 modules.
- Module convention: `modules/<feature>/{index.ts (controller/routes), service.ts (business logic class, returns status(4xx)), model.ts (TypeBox schemas)}`. Modules: auth, overview, products(+categories/variants/bulk), orders(+returns/refunds), inventory, customers, discounts, analytics, settings, storefront(public), webhooks(public).
- Plugins: `errors.ts` (global error → `{success:false,error:{code,message}}`), `auth.ts`. NOTE: README mentions `plugins/db.ts` but it doesn't exist — services import `{ db }` directly from `database/client.ts`.
- Response envelope: `{ success, data }` / `{ success, error }`; paginated adds `meta {page,limit,total,totalPages}` (`shared/pagination.ts`).

### Auth
- JWT access (1h) + refresh (7d) via @elysiajs/jwt; bcryptjs hashes; refresh rotation with `token_blacklist` table (sha256-hashed jti via `Bun.CryptoHasher`, opportunistic prune).
- **Refresh token lives in an httpOnly cookie** (`md.refresh`, path `/api/auth`, sameSite lax, secure in prod). Body still carries it for non-browser API clients/tests. Cookie is set on login/refresh and expired via `.set(expireRefreshCookie)` on logout — do NOT use `.remove()`, it emits `Path=/` which doesn't match.
- `authPlugin` derive guard: verify token → check blacklist → load active user + active merchant → context `{ auth: { user, merchant } }`. All routes scoped by `merchantId` from JWT (multi-tenant isolation).
- Roles: owner > admin > staff. `isAdmin()` = owner/admin; staff writes gated by `permissions[]` jsonb. Settings/staff routes need admin.
- CORS (`app.ts`): `CORS_ORIGINS` env (comma-separated) or defaults to localhost:5478/5479 only. In turbo globalEnv.

### DB (src/database/schema.ts)
19+4=23 tables, all merchant-scoped except merchants/settings/token_blacklist: merchants, users, categories(self-FK tree), products, product_images(sortOrder, isPrimary via products.primaryImageId), product_variants(jsonb option_values), inventory_logs(before/after), customers, orders(order_number unique per merchant; +payment_method/payment_provider/expires_at), order_items, returns, refunds(+provider_ref), coupons(unique per merchant code), promotions, store/payment/shipping/tax/notification settings (1 row per merchant, PK=merchant_id), email_logs(orderId FK cascade, template order_placed|order_paid|refund_processed, status queued|sent|failed), visits(daily per channel), token_blacklist, payment_provider_configs(PK merchant_id+provider, encrypted credentials text), payment_transactions(provider_ref indexed), webhook_events(unique provider+event_id). Migrations 0000–0004.
Conventions: ids varchar(30) cuid2; money = numeric(12,2) mode:'number'; soft-delete = products.status 'archived' (DELETE /products/:id archives); updatedAt via `$onUpdate`.
Migrations committed in `drizzle/` (0000–0002). Analytics computed live via SQL aggregation (no denormalized tables).

### Storefront public API (no auth)
`/api/store/:slug/*`: GET store, categories(tree+counts), products(filters/sort price_asc|price_desc|newest), products/:productSlug(+variants+related), search; POST checkout/preview (validates stock/variants/coupon, computes subtotal/shipping/tax/total), POST checkout (creates order, decrements inventory + logs, upserts customer), POST checkout/pay (provider flow), POST orders/:orderNumber/sync; GET orders/:orderNumber (public confirmation). Also GET `/api/store` (active store list) + `/api/store/:slug/sitemap` (category+product slugs for SEO).

### Storefront customer accounts (`modules/customer-auth`)
- `customers.passwordHash` nullable varchar(255) (migration 0006) — guests stay passwordless until they register; register on an existing guest email ATTACHES credentials to that row (past orders link automatically).
- Routes: POST `/:slug/auth/register` {email,password≥8,firstName?,lastName?} → 409 EMAIL_IN_USE if hash exists; POST `/:slug/auth/login`; GET `/:slug/auth/me`; GET `/:slug/auth/orders` (paginated, items+itemCount). All under tags ['Storefront'].
- Shopper JWT: separate `shopperJwt` instance (same ACCESS_SECRET), payload `{sub: customerId, mid: merchantId, type:'shopper'}`, TTL 30 days (`SHOPPER_TOKEN_TTL`); returned in body only — NO cookie. Guard = scoped derive plugin `shopperGuard` (like requirePermission pattern): verify type==='shopper' → load customer (must still have passwordHash) → active merchant. Cross-store tokens rejected via `CustomerAuthService.requireShopper(slug, shopper)` comparing customer.merchantId vs slug's merchant.
- Email normalization: service lowercases/trims; route-level `format:'email'` validation is strict (rejects padded strings) — clients must trim before send.

### Product reviews
- `reviews` table (migration 0007): merchantId cascade, productId cascade, customerId set-null (unique pair productId+customerId), authorName, rating 1–5 int, title/body nullable, status pending|approved|rejected (`REVIEW_STATUSES` in shared/types), indexes merchant+status. Moderation writes gated by `requirePermission('products:write')` (no dedicated permission — deliberate); reads any authed staff.
- Merchant module `modules/reviews`: GET /api/reviews?status&productId&rating&page (joins product name + customer email), PATCH /api/reviews/:id {status}, DELETE /api/reviews/:id. Swagger tag 'Reviews'. Web: nav item 'Reviews' (star icon) + `(app)/reviews/+page.svelte` status tabs w/ approve/reject/reset/delete; `/reviews` added to hooks.server.ts protected prefixes.
- Public: PDP payload now carries `rating {average,count}|null`; GET /api/store/:slug/products/:productSlug/reviews (approved only, newest first, paginated) returns `verifiedPurchase` per review = reviewer's customer has a non-cancelled order containing that product.
- Shopper submit: POST /api/store/:slug/auth/reviews {productId,rating 1–5,title?,body?} via shopperGuard — upsert on (product,customer); re-submission RESETS status to 'pending' and re-moderates; product must be active + same store; authorName = first+last name fallback email local-part.
- Storefront PDP: stars under title (anchor #reviews), full reviews section (summary card + write form when signed in via account.submitReview, Load-more pagination server-load first page with graceful `.catch(() => empty)`), JSON-LD aggregateRating when count > 0.

### Wishlists
- `wishlist_items` table (migration 0008): merchantId cascade, customerId cascade, productId cascade, unique (customerId, productId). No status — add is idempotent (`onConflictDoNothing`), remove tolerates absent rows.
- Shopper endpoints (shopperGuard, tags 'Storefront'): GET /:slug/auth/wishlist (newest first; joins active products only — archived items drop out silently; returns card data {name, slug, price, compareAtPrice, image, stock, variantId = first-created variant, optionCount}), POST /:slug/auth/wishlist {productId} (404 PRODUCT_NOT_FOUND unless product is active + same store), DELETE /:slug/auth/wishlist/:productId.
- Account singleton holds `wishlist` state loaded once per customer via ensureWishlist(fetch) (called from Header $effect + wishlist page + PDP toggle); addToWishlist refetches to keep card data accurate; logout clears. Header shows Wishlist pill with count badge.
- Storefront `/[slug]/wishlist` client-only page: grid cards (image/name/price/stock) with Add-to-cart (uses default variantId, optionValues {}) + Remove; guest sees sign-in prompt. PDP heart button next to Add-to-cart when signed in (aria-pressed, rose highlight).
- Seed fix (same batch): order generation clamps qty to remaining stock and picks from in-stock variants; variant inventory ×4 at insert (zeros stay 0 — intentional out-of-stock demos). Previously 120 seeded orders drove stock deeply negative and made test product finders flaky.

### Full-text search
- `products.search_vector` tsvector GENERATED ALWAYS AS `to_tsvector('english', name || sku || description)` STORED + GIN index (migration 0009; drizzle has no native tsvector type — declared via `customType` in schema.ts).
- `shared/product-search.ts`: `productSearchCondition(term)` = tsvector `@@ websearch_to_tsquery('english', term)` OR ILIKE name/sku fallback (prefix/partial words FTS can't see); `productSearchRank(term)` = `ts_rank(...)` for relevance ordering.
- Storefront `/products?search=` and `/search` use it; when searching with no explicit sort → rank desc, createdAt tiebreak. Merchant GET /api/products?search= uses the same condition.
- websearch_to_tsquery is injection-safe (parameterized) and word-order independent; stopword-only queries fall through to ILIKE. search.test.ts uses its own fixtures (created via merchant API, deleted in afterAll) — don't depend on seed product names.

### Product images + uploads
- `modules/uploads`: POST `/api/uploads` (`t.Files`, jpg/png/webp/gif ≤5MB, `requirePermission('products:write')`) → saves under `apps/api/uploads/<cuid2>.<ext>`; public static GET `/uploads/*` (declared BEFORE authPlugin — Elysia scoped derives only apply to routes registered after `.use()`). Storage adapter in `shared/storage.ts`.
- `product_images` rows (sortOrder asc, createdAt tiebreak); products carry `images[]` + `primaryImage`; product update = full-set replace. Web ImageManager component handles upload/reorder/primary/delete; dev proxy `/uploads` in both SvelteKit vite configs.

### Transactional emails
- `shared/mailer.ts`: ResendMailer (fetch-based, RESEND_API_KEY) with NoopMailer fallback that just marks logs sent/providerRef 'noop'; `setMailer(null)` is the test seam.
- `modules/emails/service.ts`: fire-and-forget (never blocks checkout); writes email_logs queued→sent|failed; skips silently when merchant notifications disabled or template opted out. Triggers: orderPlaced (plain checkout + provider checkout), orderPaid (unpaid→paid transition), refundProcessed (createRefund). Sender identity = notificationSettings.fromName/fromEmail → store name / MAIL_FROM_FALLBACK → 'onboarding@resend.dev'.
- Settings: notification_settings row via GET/PUT `/api/settings/notifications` (enabled, fromName, fromEmail, templates{order_placed,order_paid,refund_processed}). Web Settings→Notifications tab.

### SEO + funnel events (storefront)
- Routes: `/sitemap.xml` (index over active stores), `/[slug]/sitemap.xml` (home/products/categories/products URLs), `/robots.txt` (disallows cart/checkout/orders). Base URL = PUBLIC_STOREFRONT_URL ?? request origin; image URLs absolutized against PUBLIC_API_URL (`$lib/seo.ts`).
- Meta: title/description/canonical/OG on home, products list, PDP (+JSON-LD Product schema w/ Offer, `<` escaped to `\u003c`), category; noindex on search/cart/checkout/orders/return. NOTE: `{expr}` inside template `<script>` tags renders literally — must use `{@html \`<script ...>${json}</script>\`}`.
- Funnel events: POST `/api/store/:slug/events` {type view|cart_add|checkout_start, channel?} upserts daily visits rows (merchantId+date+channel unique). `$lib/analytics.ts track()` fires from PDP view effect, cart.add(), checkout mount.

### Payments (multi-provider, BYOK)
- Adapters in `src/payments/`: `types.ts` (`PaymentProviderAdapter` interface), `registry.ts` (`getProvider`/`listProviders`), `myfatoorah.ts`, `tamara.ts`. New provider = implement adapter + register.
- Phase 1 providers: **MyFatoorah** (cards/KNET/Mada/Apple Pay; live host per country api-sa/api-ae/api-qa/api-eg; test = apitest) + **Tamara** (BNPL; webhook = HS256 JWT `tamara_token` signed with merchant notification token, verified timing-safe via `verifyTamaraJwt`) + legacy COD/manual methods from payment settings.
- Per-merchant config rows in `payment_provider_configs` (PK merchant_id+provider); credentials stored AES-256-GCM encrypted (`shared/crypto.ts` encryptJson/decryptJson, key = sha256(ENCRYPTION_KEY)). Secrets are write-only — GET returns only `configured` flag; PUT ignores masked `••••xxxx` values (keeps stored).
- Flow: `/checkout/pay` creates order pending/**unpaid** with stock held + `expires_at=+30min` → adapter hosted session → redirect. Return page `/[slug]/checkout/return` calls `/sync` (server-side re-verify, never trust redirect payload). Webhooks `POST /api/webhooks/:provider/:slug` idempotent via `webhook_events` (unique provider+eventId). Only unpaid→paid transitions; clears expiresAt + updates customer totalSpent.
- Sweeper: `StorefrontService.sweepExpiredOrders()` on 5-min `setInterval` (.unref()) — stale unpaid past expiry → cancelled/failed + inventory restock (reason 'cancel').
- Refunds method='original' on provider orders hit gateway first (MakeRefund / simplified-refund), ref saved to `refunds.provider_ref`; failure throws REFUND_FAILED.
- Money helper now numeric(12,**3**) for KWD/BHD/OMR/JOD (`shared/currency.ts` roundForCurrency/currencyDecimals).
- Legacy manual `'card'` method intentionally still places orders as paid-on-place (test compat). Provider methods on plain /checkout → 400 PAYMENT_REQUIRES_REDIRECT; unavailable methods → PAYMENT_METHOD_UNAVAILABLE.
- Env additions: ENCRYPTION_KEY (required for provider config), PUBLIC_API_URL (webhook base), PUBLIC_STOREFRONT_URL (return base) — all in turbo globalEnv.
- Web dashboard Settings→Payments renders provider cards (mode select, country, masked credential inputs, Save + Test connection). Storefront checkout shows online providers above COD/manual; sessionStorage flag `ecom:pending:${slug}` releases cart after confirmed paid.

### Audit logs / activity trail
- `audit_logs` table (migration 0015): `id` cuid2 PK, `merchantId` (cascade FK), `actorUserId` (nullable, set-null FK to `users`), `actorName` (denormalized snapshot), `action` varchar(100), `entityType`/`entityId`, `metadata` jsonb default `{}`, `ipAddress`, `createdAt`. Indexes on merchant+created, merchant+action, entity. All merchant-scoped.
- Merchant module `modules/audit-logs`: GET `/api/audit` (paginated; filters action/entityType/entityId/from/to) + GET `/api/audit/:id`. Swagger tag 'Audit Logs'. Reads need any valid auth (no extra permission).
- Recording: fire-and-forget `auditFromRequest(auth, request, {action, entityType?, entityId?, metadata?})` helper (in `modules/audit-logs/index.ts`) derives IP from `x-forwarded-for` and calls `AuditService.log()` (never throws, action sliced to 100). Wired into WRITE endpoints of products (create/update/archive/bulk/import/variants/categories), orders (status_change), inventory (adjust), reviews (moderate), discounts (coupons+promotions CRUD), settings (staff CRUD), api-keys (create/revoke), customer-tags (add/remove), auth (login). Audit calls never await/block the request.
- Web: nav item 'Audit Log' (shield icon, `/audit`), added to `hooks.server.ts` PROTECTED_PREFIXES, `(app)/audit/+page.svelte` (svelte 5 runes; filters entityType+action, table time/actor/action-badge/entity/details/IP, `dateTimeFull`, Pagination). `AuditEntry` type in `web/src/lib/types.ts`.
- NOTE: build the migration before deploying (the API writes to audit_logs at runtime; missing table won't crash requests thanks to the fire-and-forget catch, but nothing will be recorded).

## Web dashboard (apps/web)
Routes under `(app)/`: dashboard, analytics(tabs+range), products(list+[id] variants, CreateEditProduct modal, CategoriesManager), inventory(all/low/out/history), orders(list+[id] returns/refunds), customers(list+[id]), discounts(coupons/promotions tabs), settings(store/payments/shipping/taxes/staff), reviews, audit. Plus `/login`, `/` redirector.
State: `session.svelte.ts` (Svelte 5 runes singleton; bootstrap() hydrates from /auth/me; login() now also fetches settings via fetchMe; isAdmin, can(perm)); **access token only** in localStorage (`md.access`) — refresh is cookie-based; api.ts single-flight refresh (`refreshPromise ??=`) so concurrent 401s share one refresh call. UI components: Badge, Button, Card, Modal, Pagination, Toast (+toast.svelte.ts store).
`hooks.server.ts`: server-side guard — protected prefixes (dashboard/analytics/products/inventory/orders/customers/discounts/settings) require `md.refresh` cookie else 302 /login; /login redirects to /dashboard when session present. Presence check only (not JWT verification) — real auth still enforced by API.

## Storefront (apps/storefront)
Routes under `[slug]/`: home(featured 8, meta/OG), products(list w/ filter form), products/[product](variant picker PDP, gallery + JSON-LD Product), categories/[category], search(?q=), cart(client-side), checkout(contact/address/coupon → preview → place order; online providers → /checkout/pay → gateway redirect, sessionStorage `ecom:pending:${slug}`; prefills email/name/phone from shopper session when signed in), checkout/return(sync + redirect to confirmation, retry on pending), orders/[orderNumber](confirmation; pending-payment banner with "Check now" re-sync), account(client-only: login/register tabs → profile + paginated order history linking to confirmation pages; 401 auto-logout). Plus root `/sitemap.xml`, `/[slug]/sitemap.xml`, `/robots.txt`.
Cart: `cart.svelte.ts` class singleton, localStorage key `ecom:cart:${slug}`, lines snapshot product data at add-time, merge by variantId, qty cap 99. Shopper session: `account.svelte.ts` singleton, localStorage key `ecom:auth:${slug}` (token+customer), `setSlug/login/register/orders/logout/isAuthError`. Header shows Sign in / first-name pill linking to account. api.ts uses injected fetchFn (SSR-safe), typed ApiError, plus `loadError(err, notFoundMessage)` helper — all page.server loads wrap API calls; ApiError 404 → SvelteKit error(404), else error(status)/rethrow. Home degrades gracefully to empty featured list. PDP resets variant/qty/notice via `$effect` keyed on `data.product.id`; selectedVariant falls back to variants[0] when stale.

## Known issues / remaining tech debt (after fix batch 2026-08-22)

**Fixed in this batch**
- ✅ Refresh token httpOnly cookie (API + web), body kept as fallback for tests/non-browser clients
- ✅ web refresh race — single-flight `refreshPromise`
- ✅ web session.login() now hydrates settings
- ✅ web server-side route guard (hooks.server.ts) + /login bounce
- ✅ CORS tightened (CORS_ORIGINS env or localhost:5478|5479 default)
- ✅ storefront: all page.server loads have error handling (404 vs 5xx); layout no longer masks backend 5xx as "store not found"
- ✅ PDP variant state resets on navigation
- ✅ +error.svelte added to both SvelteKit apps
- ✅ CI postgres:16 → :18 (matches compose)
- ✅ README drift fixed (structure, plugins/db.ts, auth flow docs)

**Still open**
- a11y warnings (~70) in web svelte-check — mostly label/control associations in settings page
- No lint config anywhere despite turbo `lint` task; web/storefront lack separate `typecheck` scripts (only `check`)
- adapter-auto unpinned in both SvelteKit apps; prod API origin config still dev-proxy-only
- hooks.server.ts guard is cookie-presence based, not JWT-verified (fine as UX guard; API enforces real auth)
- Logout endpoint returns 400 when POSTed with content-type json but empty body (clients send `{}`)
- Roadmap Phase 2 (next): CSV export/import (customer accounts ✅, reviews ✅, wishlists ✅, FTS search ✅ done); Phase 3: fulfillment tracking, abandoned-cart queue (pg-boss), outbound merchant webhooks, multi-warehouse, i18n ar+RTL (prioritized per user)

## Gotchas
- Elysia: method chaining required for type inference; explicit `.use()` for plugins that add context types
- drizzle-typebox: pre-declare schema vars before t.Omit/t.Pick (infinite type instantiation otherwise)
- Elysia Cookie: `.remove()` ignores custom path (emits Path=/) — expire cookies via `.set({ value:'', maxAge:0, expires:new Date(0), path })` instead. Cookie.set() merges over `initial`, not previous set() calls.
- Docker on this machine needs `sudo docker`
- Bun installed at `~/.bun/bin` (add to PATH if missing)
- pkill -f self-matches the bash command string — kill by exact PID from `ps -eo pid,args | grep ... | grep -v grep` instead
- Tests that place storefront orders must restore inventory + delete upserted customers in afterAll, or they poison checkout/smoke tests (stock thresholds + exact customer counts)
- Svelte: `{expr}` inside template `<script>` tags renders literally — JSON-LD needs `{@html \`<script>${json}</script>\`}` with `<` escaped to `\u003c`
