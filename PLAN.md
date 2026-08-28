# JamiCore Food Commerce — OpenCode Implementation Plan

## Mission

Extend the existing JamiCore e-commerce platform into a multi-tenant Commerce Operating System with an optional Food/Restaurant module.

**Core decision:** one dashboard shell for every user. Access is determined by:
1. Merchant enabled modules
2. User role
3. Permissions
4. Outlet scope

Do not build separate dashboards for Owner, Kitchen Staff, Driver, Cashier, etc.

Frontend hiding is UX only. Every protected API operation must enforce authorization server-side.

---

## 1. Non-negotiable rules

- Work incrementally in small phases.
- Inspect the existing repository before modifying anything.
- Reuse existing auth, DB, API, validation, UI and response conventions.
- Do not rewrite unrelated existing modules.
- Do not duplicate existing order/payment/customer infrastructure unnecessarily.
- Do not modify already-audited security-sensitive flows unless explicitly required.
- After every phase run the existing tests, typecheck/lint/build where available.
- Never claim tests passed unless they actually ran.
- Do not invent dependencies.
- Database migrations should be additive and reversible where practical.
- Enforce tenant isolation on every merchant-owned query.
- Enforce outlet scope server-side.
- Use transactions for multi-record state changes.
- Use idempotency for external events where applicable.

---

## 2. Phase 0 repository audit

Before changing code, inspect:

- `apps/api`
- `apps/web`
- `apps/storefront`
- database/schema/migrations
- auth/session
- users/merchants/tenants
- products/orders/customers/payments
- RBAC
- outlets/locations
- dashboard/routes/components
- package/workspace configuration
- tests and build commands

Produce:

```text
Existing:
- Auth:
- Users:
- Merchants/Tenants:
- Products:
- Orders:
- Customers:
- Payments:
- Roles/permissions:
- Outlets/locations:
- Dashboard:
- Database:
- Tests:
- Runtime/deployment:
- Reusable services/components:
- Conflicts/missing foundations:
```

Do not implement Phase 1 during Phase 0.

---

## 3. Target tenant hierarchy

```text
Platform
  |
  +-- Merchant / Tenant
       |
       +-- Business / Brand
       |
       +-- Outlet
       |    +-- POS
       |    +-- Kitchen
       |    +-- Tables
       |    +-- Delivery
       |
       +-- Users
       +-- Roles
       +-- Permissions
       +-- Enabled Modules
```

A merchant can have multiple outlets.

Users can be assigned to one or more outlets.

---

## 4. Modules

Initial identifiers:

```text
commerce
restaurant
pos
kitchen
tables
delivery
inventory
marketing
analytics
```

Examples:

Normal e-commerce:
```text
commerce
inventory
marketing
analytics
```

Restaurant:
```text
commerce
restaurant
pos
kitchen
tables
delivery
inventory
marketing
analytics
```

Cloud kitchen:
```text
commerce
restaurant
pos
kitchen
delivery
inventory
analytics
```

Do not show or permit disabled modules.

---

## 5. RBAC

Keep these concepts separate:

```text
Role != Permission != Module != Outlet Scope
```

Default roles:

```text
owner
admin
manager
cashier
captain
kitchen_manager
kitchen_staff
inventory_manager
delivery_manager
driver
accountant
support
```

Allow custom roles.

Initial permission examples:

```text
orders.read
orders.create
orders.update
orders.cancel

products.read
products.create
products.update
products.delete

menu.read
menu.manage

kitchen.read
kitchen.manage

kds.read
kds.manage

tables.read
tables.manage

delivery.read
delivery.assign
delivery.manage

drivers.read
drivers.manage

inventory.read
inventory.adjust
inventory.manage

payments.read
payments.create
payments.refund

reports.read

staff.read
staff.manage

settings.read
settings.manage
```

Scopes:

```text
GLOBAL
MERCHANT
OUTLET
OWN
```

Examples:
- Owner: merchant-wide
- Outlet Manager: assigned outlet
- Kitchen Staff: assigned outlet + kitchen
- Driver: own assigned deliveries

---

## 6. Unified dashboard

One shell:

```text
Dashboard
  |
  +-- dynamic navigation
  +-- module routes
  +-- permission guards
  +-- outlet selector
```

Navigation is generated from:

```text
enabled modules
+
permissions
+
outlet scope
```

Example Owner:

```text
Dashboard
Orders
Products
Customers

Restaurant
  Menu
  Tables
  Kitchen
  KDS

Delivery
  Orders
  Drivers
  Dispatch
  Zones

Inventory
  Ingredients
  Recipes
  Stock
  Suppliers

Marketing
Payments
Reports
Staff
Settings
```

Kitchen Staff:

```text
Dashboard
Orders
Kitchen
KDS
```

Driver:

```text
Dashboard
My Deliveries
Current Delivery
Earnings
History
```

API authorization remains mandatory.

---

## 7. Merchant/outlet context

Create or reuse a reliable server-side context:

```text
currentUser
currentMerchant
allowedOutlets
selectedOutlet
permissions
enabledModules
```

Never trust arbitrary browser-supplied `merchantId` or `outletId`.

Resolve merchant from authenticated session/user.

Validate selected outlet against user assignments.

Every merchant-owned query must enforce tenant isolation.

---

## 8. Unified order engine

Do not create separate order systems for:

- dine-in
- takeaway
- delivery
- QR
- POS

Extend the existing order model/service where possible.

Order types:

```text
DINE_IN
TAKEAWAY
DELIVERY
QR
POS
SCHEDULED
```

General lifecycle:

```text
CREATED
  |
CONFIRMED
  |
PREPARING
  |
READY
  |
FULFILLMENT
  |
COMPLETED
```

Delivery lifecycle:

```text
UNASSIGNED
ASSIGNED
ARRIVED_AT_PICKUP
PICKED_UP
IN_TRANSIT
ARRIVED
DELIVERED
FAILED
CANCELLED
```

Implement validated state transitions. Do not scatter raw status assignments.

---

## 9. Restaurant menu

Entities/concepts:

```text
categories
menu_items
variants
modifier_groups
modifiers
```

Menu item needs:

- name
- description
- image
- price
- tax
- availability
- preparation time
- kitchen station
- dietary tags
- allergens
- outlet availability
- outlet-specific price where required
- time-based availability

Variants example:

```text
Burger
  Regular
  Large
  Combo
```

Modifiers:

```text
Add-ons
  Cheese
  Egg
  Extra Patty
```

Support required/optional, min/max selections, price adjustments and availability.

---

## 10. Dine-in + QR

Entities:

```text
table_sections
tables
table_sessions / table_orders
```

Table states:

```text
AVAILABLE
RESERVED
OCCUPIED
ORDERING
DINING
BILL_REQUESTED
PAYMENT_PENDING
CLEANING
```

Features:

- floor/table view
- sections
- QR per table
- captain ordering
- move table
- merge table
- split bill
- transfer order
- reservations
- waitlist

QR flow:

```text
Scan
 ↓
Public table context
 ↓
Menu
 ↓
Cart
 ↓
Order
 ↓
Kitchen
```

QR tokens must not grant private merchant access.

---

## 11. Kitchen + KOT + KDS

Kitchen is not just order status.

Entities:

```text
kitchen_stations
kitchen_station_items / routing rules
kitchen_tickets
kitchen_ticket_items
```

Example:

```text
Order #1024
 |
 +-- Grill
 |    +-- Chicken Burger x2
 |
 +-- Drinks
 |    +-- Coke x2
 |
 +-- Dessert
      +-- Brownie x1
```

KDS states:

```text
NEW
ACCEPTED
PREPARING
READY
RECALLED
CANCELLED
```

Requirements:

- station filtering
- ticket timer
- preparation SLA
- priority
- notification
- item-level completion
- bump
- recall
- delayed indication
- ready handoff

---

## 12. Takeaway

```text
Order
  |
Kitchen
  |
READY
  |
Pickup Counter
  |
Verification
  |
COMPLETED
```

Support pickup status and handoff verification.

---

## 13. Delivery

Entities:

```text
delivery_zones
delivery_orders
drivers
driver_assignments
driver_locations
```

Delivery lifecycle:

```text
UNASSIGNED
ASSIGNED
ARRIVED_AT_PICKUP
PICKED_UP
IN_TRANSIT
ARRIVED
DELIVERED
FAILED
CANCELLED
```

Delivery zones should support:

- radius
- polygon later if required
- delivery fee
- minimum order
- free-delivery threshold
- ETA
- outlet-specific serviceability

Start with radius-based zones if the current geo architecture is simple.

---

## 14. Driver + dispatch

Driver states:

```text
OFFLINE
ONLINE
BUSY
PAUSED
SUSPENDED
```

Driver data:

- profile
- vehicle
- documents
- status
- assigned outlet
- current delivery
- earnings
- history

Initial dispatch:

```text
Order ready/dispatchable
  |
  v
Eligible drivers
  |
  +-- online
  +-- correct outlet/zone
  +-- not suspended
  +-- acceptable workload
  |
  v
Assignment
```

Do not build AI dispatch first.

Later scoring may include:

```text
distance
availability
workload
ETA
zone
```

---

## 15. Inventory

Food inventory is ingredient/recipe based.

Entities:

```text
ingredients
recipes
recipe_items
inventory
inventory_movements
suppliers
purchase_orders
```

Example:

```text
Chicken Burger
  Bun        x1
  Chicken    150g
  Cheese     x1
  Sauce      20g
```

Use auditable inventory movements. Do not silently mutate stock.

Support:

- stock on hand
- low stock
- wastage
- purchase
- suppliers
- batch
- expiry
- recipe costing

---

## 16. POS

Reuse the common order/payment engine.

Features:

```text
New Order
Tables
Takeaway
Delivery
Payments
Hold
Recall
Receipt
```

Payment methods may include:

```text
CASH
UPI
CARD
ONLINE
```

Support:

- split payment
- partial payment
- discount
- tip
- tax
- receipt
- refund
- shift
- cash closing

Do not duplicate payment logic.

Do not alter previously reviewed payment webhook logic unless explicitly required later.

---

## 17. Aggregators

Use an adapter architecture:

```text
AggregatorAdapter
  |
  +-- ZomatoAdapter
  +-- SwiggyAdapter
  +-- FutureAdapter
```

Never place provider-specific behavior directly inside the generic order service.

Responsibilities:

- menu sync
- item availability
- outlet mapping
- incoming orders
- order status
- cancellation
- provider delivery status
- webhooks

External events must be idempotent.

---

## 18. Reports

Sales:
- revenue
- orders
- AOV
- payment method

Kitchen:
- average prep time
- station performance
- delayed tickets
- throughput

Delivery:
- average delivery time
- driver performance
- cancellations
- failures

Inventory:
- food cost
- wastage
- consumption
- low stock

Outlet:
- outlet comparison
- peak hours
- top products

Start with operational reports.

---

## 19. Staff

Concepts:

```text
staff
roles
permissions
user_outlets
shifts
attendance
```

A user may have multiple outlets.

Example:

```text
User: Antony
Role: Manager

Kochi: allowed
Ernakulam: allowed
Trivandrum: denied
```

---

## 20. Audit logging

Audit:

```text
role changes
permission changes
staff changes
order cancellation
refund
inventory adjustment
price changes
menu changes
outlet settings
delivery reassignment
```

Store:

```text
actor
merchant
outlet
action
resource
resourceId
timestamp
metadata
```

Never store passwords, refresh tokens, API secrets or unnecessary sensitive data.

---

## 21. API conventions

Reuse existing JamiCore conventions.

Logical target areas:

```text
/api/merchant
/api/outlets
/api/modules
/api/roles
/api/permissions
/api/staff
/api/menu
/api/tables
/api/kitchen
/api/kds
/api/delivery
/api/drivers
/api/dispatch
/api/delivery-zones
/api/inventory
/api/recipes
/api/ingredients
/api/pos
/api/reports
/api/aggregators
```

Do not duplicate existing routes.

Every protected endpoint:

```text
authenticate
  ↓
resolve merchant
  ↓
resolve outlet scope
  ↓
check module enabled
  ↓
check permission
  ↓
validate input
  ↓
execute
  ↓
standard response
```

---

## 22. Frontend routes

Reuse existing SvelteKit conventions.

Logical target:

```text
/dashboard
/dashboard/orders
/dashboard/products
/dashboard/customers

/dashboard/restaurant/menu
/dashboard/restaurant/tables
/dashboard/restaurant/kitchen
/dashboard/restaurant/kds

/dashboard/delivery
/dashboard/delivery/drivers
/dashboard/delivery/dispatch
/dashboard/delivery/zones

/dashboard/inventory
/dashboard/inventory/ingredients
/dashboard/inventory/recipes
/dashboard/inventory/stock

/dashboard/staff
/dashboard/reports
/dashboard/settings
```

Do not create separate applications per role.

---

## 23. Navigation definition

Centralize navigation metadata:

```text
module
permission
route
label
icon
```

Example:

```text
{
  label: "Kitchen",
  route: "/dashboard/restaurant/kitchen",
  module: "kitchen",
  permission: "kitchen.read"
}
```

Frontend filters unavailable navigation.

Server enforces access.

---

## 24. Security

Preserve and verify:

- tenant isolation
- outlet isolation
- RBAC
- permission checks
- secure auth/session
- CSRF protections where applicable
- security headers
- rate limiting
- account lockout
- timing-safe API key comparisons
- no access token in localStorage
- httpOnly refresh cookie

Do not modify these already-reviewed areas:

- payment webhook logic
- upload handling
- password reset
- JWT refresh rotation

unless explicitly required by a future audit.

---

## 25. Multi-instance readiness

Do not depend on process-local state for shared business state.

Shared infrastructure should eventually handle:

- rate limiting
- distributed locks where needed
- realtime pub/sub
- background jobs
- scheduled jobs
- cross-instance idempotency

Keep the existing rate-limit storage abstraction compatible with Redis.

Realtime events should eventually use shared infrastructure when multiple instances are running.

---

## 26. Development phases

### Phase 0 — Audit
Repository/schema/auth/RBAC/order/dashboard inventory. No feature implementation.

### Phase 1 — Foundation ✅
Merchant/outlet/module/RBAC/user-outlet context.

Tests:
- tenant isolation
- outlet isolation
- permission enforcement
- disabled module rejection

### Phase 2 — Dynamic Dashboard ✅
One shell, dynamic navigation, outlet selector, permission-aware widgets.

Tests:
- owner access
- kitchen access restrictions
- driver restrictions
- disabled modules inaccessible

### Phase 3 — Food Menu ✅
Categories, items, variants, modifiers, availability, outlet rules.

### Phase 4 — Unified Food Orders
Order types and validated state machine.

### Phase 5 — Tables + QR
Tables, sections, QR, sessions, move/merge/split.

### Phase 6 — Kitchen + KOT + KDS
Stations, routing, tickets, timers, priority, recall.

### Phase 7 — Delivery
Zones, drivers, assignment, lifecycle, pickup, completion.

### Phase 8 — Inventory
Ingredients, recipes, stock, movements, wastage, suppliers, costing.

### Phase 9 — POS
POS UI using existing order/payment infrastructure.

### Phase 10 — Reports
Sales, kitchen, delivery, inventory, outlet reporting.

### Phase 11 — Aggregators
Adapter abstraction, provider configuration, mappings, menu/order/status sync, webhooks.

### Phase 12 — Realtime + Optimization
Realtime KDS, tracking, notifications, dispatch optimization, background jobs.

Do not automatically proceed to the next phase.

---

## 27. Testing strategy

Every phase should include relevant:

### Unit tests
- validation
- state transitions
- permission decisions
- calculations
- inventory logic
- delivery zone logic

### Integration tests
- authentication
- tenant isolation
- outlet isolation
- transactions
- order lifecycle
- kitchen lifecycle
- delivery lifecycle

### Security tests

Test direct API access as:

```text
owner
admin
manager
cashier
kitchen_staff
driver
support
```

Attempt cross-tenant and cross-outlet access.

Examples:

```text
merchant A -> merchant B resource
outlet A -> outlet B resource
driver A -> driver B delivery
```

All unauthorized access must fail.

### E2E

Minimum flows:

```text
Restaurant onboarding
Menu -> Order -> Kitchen -> Ready
Dine-in -> Table -> Order -> Payment
Delivery -> Assignment -> Pickup -> Delivery
Driver -> Assigned -> Completed
```

---

## 28. Performance

Avoid N+1 queries.

Index based on actual queries, especially:

```text
merchant_id
outlet_id
user_id
status
created_at
order_type
driver_id
kitchen_station_id
```

Paginate:

- orders
- customers
- products
- inventory
- audit logs
- drivers

Do not add indexes blindly.

---

## 29. Concurrency

Protect:

- inventory deductions
- table assignment
- order state transitions
- driver assignment
- payment state
- duplicate KOT creation

Use transactions, locks and unique constraints where appropriate.

Never rely on non-atomic check-then-act logic for shared state.

---

## 30. Observability

Structured logs around:

```text
order state changes
kitchen ticket creation
delivery assignment
inventory adjustment
aggregator events
permission failures
```

Never log passwords, tokens, API secrets or unnecessary sensitive data.

---

## 31. Definition of done

A phase is complete only when:

- implementation complete
- migrations complete
- API validation exists
- authorization exists
- tenant/outlet isolation verified
- frontend exists where applicable
- tests exist
- tests actually pass
- typecheck passes
- build passes
- no unrelated audited security flow changed
- changed files reported

---

# OpenCode Execution Protocol

OpenCode must NOT implement this entire plan in one operation.

For each phase:

1. Read the repository.
2. Identify exact files to change.
3. Explain intended changes briefly.
4. Implement only that phase.
5. Run tests/typecheck/build.
6. Inspect the git diff.
7. Check for accidental unrelated changes.
8. Fix failures.
9. Report:
   - files changed
   - database changes
   - API changes
   - frontend changes
   - tests/results
   - security considerations
   - next phase

Then STOP and wait for approval.

Do not automatically proceed to another phase.

---

# First OpenCode task

Start with **Phase 0 only**.

Do not modify feature code.

Inspect the repository and produce:

```text
1. Current architecture
2. Existing database schema
3. Existing auth/RBAC
4. Existing merchant/tenant model
5. Existing order model
6. Existing frontend dashboard
7. Existing reusable components/services
8. Existing tests
9. Existing deployment/runtime assumptions
10. Conflicts or missing foundations
11. Exact recommended Phase 1 file list
```

Do not implement Phase 1 until Phase 0 is reviewed and approved.
