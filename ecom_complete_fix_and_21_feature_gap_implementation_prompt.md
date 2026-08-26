# E-commerce — Complete Production Fix + 21 Feature Gap Implementation Prompt

## Purpose

This is the **single implementation prompt** for the current `ecom_new-main` repository.

The implementation agent/coder must work on the **existing codebase** and must NOT restart, rewrite, or replace the architecture.

The objective is:

1. Fix all remaining production/correctness issues found in the latest audit.
2. Implement the **21 remaining product feature gaps** listed below.
3. Preserve the existing working functionality.
4. Add tests for every critical business-state change.
5. Leave the project in a buildable, type-safe, migration-safe state.
6. Produce a final implementation report showing exactly what was changed and what remains.

---

# NON-NEGOTIABLE RULES

## Rule 1 — Do NOT rebuild the project

Do not:

- restart the repository
- replace the existing architecture
- migrate to another framework
- rewrite the API
- replace Drizzle
- replace Turborepo/Bun
- replace the existing frontend stack
- create a second competing implementation

Modify the current implementation incrementally.

---

## Rule 2 — Payment demo is OUT OF SCOPE

The current demo payment behaviour is intentionally left for a later phase.

**Do NOT spend implementation time changing the demo payment behaviour in this task.**

Do not count demo payment behaviour as a blocker.

However:

- keep the payment abstraction intact
- do not break provider adapters
- do not break payment webhooks
- do not break refund integration
- do not remove existing payment interfaces

Real payment-provider production hardening can be handled separately later.

---

## Rule 3 — Business state changes must have one authoritative service

Do not implement the same business operation differently in multiple controllers/routes.

Use authoritative domain/service operations for:

```text
Order lifecycle
Payment lifecycle
Refund lifecycle
Return lifecycle
Inventory lifecycle
Coupon lifecycle
Promotion lifecycle
Fulfillment lifecycle
```

A route/controller should call the domain operation.

It must not independently mutate the same business state.

---

## Rule 4 — Multi-tenant isolation is mandatory

Every merchant-owned entity must remain scoped to the current merchant.

Never trust IDs supplied by the client without ownership validation.

At minimum verify:

```text
merchantId
product ownership
variant → product ownership
order ownership
customer ownership where applicable
coupon ownership
promotion ownership
inventory ownership
return ownership
refund ownership
webhook ownership
fulfillment ownership
warehouse ownership
```

Never introduce a query such as:

```ts
where(eq(table.id, id))
```

for merchant-owned data when it should also include:

```ts
eq(table.merchantId, merchantId)
```

unless ownership is already guaranteed by a locked parent query.

---

# PRIORITY MODEL

Use this order.

## P0 — Must fix before production

These are correctness/security/data-integrity issues.

```text
P0-01 Order cancellation state machine
P0-02 Refund completion/reconciliation correctness
P0-03 Return/refund/inventory state consistency
P0-04 Inventory mutation concurrency
P0-05 Promotion application must not corrupt checkout totals
P0-06 Tenant isolation verification
```

## P1 — Core production commerce

```text
P1-01 Email/no-op delivery correctness
P1-02 Password reset
P1-03 Email verification
P1-04 Customer address book
P1-05 Fulfillment/shipment
P1-06 Courier integration abstraction
P1-07 GST invoicing / credit notes
P1-08 Pincode serviceability
P1-09 COD rules
P1-10 Merchant outbound webhooks
P1-11 Durable background jobs
P1-12 Abandoned cart
```

## P2 — Advanced merchant platform

```text
P2-01 Multi-warehouse
P2-02 COGS / profit
P2-03 Customer segmentation
P2-04 Marketing automation
P2-05 Loyalty
P2-06 Affiliate/referral
P2-07 CMS
P2-08 Theme/page builder
P2-09 Advanced search
P2-10 API keys/developer platform
```

The exact implementation order may be adjusted only when a dependency requires it.

---

# PART A — REMAINING CORRECTNESS FIXES

## P0-01 — Unify the order cancellation state machine

### Current problem

The repository has a shared cancellation operation, but cancellation rules must be made completely consistent across:

- explicit cancel endpoint
- generic order status endpoint
- payment-related flows
- background/sweep flows
- webhook-driven flows
- staff dashboard actions

There must never be one path that changes:

```text
processing → cancelled
```

without performing the same business side effects as the authoritative cancellation operation.

### Required behaviour

Only valid order states may enter cancellation.

For example:

```text
pending → cancelled
processing → cancelled
```

Paid orders must not be silently cancelled.

If money has moved:

```text
paid
partially_refunded
```

the order must use the refund workflow.

Shipped/delivered orders must use the return/refund workflow according to business rules.

### Cancellation must atomically handle

```text
order status
inventory restoration
approved-return deduction
coupon usage restoration
payment-state validation
audit/event record
```

### Important

The generic status mutation endpoint must NOT be able to bypass the cancellation service.

If:

```text
input.status === "cancelled"
```

route it through the authoritative cancellation operation.

### Tests required

- pending unpaid → cancel succeeds
- processing unpaid → cancel succeeds
- paid pending → cancel rejected
- paid processing → cancel rejected
- shipped → cancel rejected
- delivered → cancel rejected
- duplicate cancel → rejected/idempotent
- cancellation during checkout
- cancellation during return approval
- cancellation during refund
- cancellation restores inventory exactly once
- cancellation restores coupon usage exactly once

---

# P0-02 — Refund completion must represent a real refund

### Current problem

A refund record must never be marked:

```text
completed
```

unless the actual refund operation has succeeded or the system has an explicit, auditable provider-confirmed/manual settlement state.

### Required state model

At minimum:

```text
pending
completed
failed
```

Prefer:

```text
pending
processing
completed
failed
```

### Required flow

```text
BEGIN TRANSACTION

lock order
lock/check refundable balance
reserve refund amount
create refund = pending

COMMIT

call provider

SUCCESS:
    transaction:
        mark refund completed
        update payment/order aggregate state
        write audit event

FAILURE:
    transaction:
        mark refund failed
        release refund reservation
        preserve original payment state
```

### Crash/retry safety

Handle:

```text
gateway succeeded
application crashed
database update did not happen
```

Do not create duplicate external refunds.

Use provider reference/idempotency key wherever supported.

Persist:

```text
provider refund id
provider transaction id
idempotency key
attempt count
last error
timestamps
```

Add reconciliation logic for uncertain states.

### Manual/no-provider case

If the application intentionally supports manual refunds:

```text
manual_pending
manual_completed
```

must be explicit.

Do not pretend a manual refund was completed by a gateway.

---

# P0-03 — Return / refund / inventory consistency

The following operations must not double-apply inventory:

```text
order cancellation
return approval
return restock
refund
```

### Required invariant

For every order item:

```text
restocked quantity
<=
cancelled quantity + approved return quantity
```

and the same units must never be counted twice.

### Tests

Concurrent:

```text
cancel + return approval
cancel + refund
two return approvals
two refund requests
return approval + refund
```

must leave the final inventory correct.

---

# P0-04 — Inventory mutation must be concurrency safe everywhere

All absolute inventory changes must use the same concurrency-safe inventory service.

This includes:

```text
checkout decrement
dashboard edit
variant edit
CSV import
bulk update
return restock
cancellation restock
manual adjustment
```

### Required approach

Use row locking / atomic mutation:

```text
BEGIN
SELECT variant FOR UPDATE
validate current inventory
calculate new value
UPDATE variant
INSERT inventory log
COMMIT
```

Do not:

```text
SELECT stock
...
UPDATE stock
```

outside the protected transaction.

### Required invariant

Inventory logs must correctly represent:

```text
beforeValue
change
afterValue
reason
merchantId
variantId
reference
```

---

# P0-05 — Promotion application must be real and safe

Promotion CRUD alone is not a complete promotion feature.

The checkout engine must actually calculate promotions.

### Required

Promotion resolution must happen server-side.

Never trust frontend discount totals.

Support at minimum:

```text
discount_on_products
buy_x_get_y
all products scope
specific products scope
category scope
start date
end date
active/disabled status
usage limit
```

Design the system so it can later support:

```text
percentage
fixed amount
minimum subtotal
customer limit
first-order
free shipping
stacking rules
priority
```

### Checkout calculation

The server must calculate:

```text
subtotal
promotion discount
coupon discount
shipping
tax
grand total
```

with a deterministic order.

Prevent:

```text
negative totals
double discount
discount on excluded products
expired promotion
future promotion
cross-merchant promotion
usage-limit bypass
```

### Tests

- active promotion
- expired promotion
- future promotion
- disabled promotion
- product scope
- category scope
- all-products scope
- promotion + coupon
- concurrent usage
- cross-merchant ID
- zero/negative totals
- checkout preview vs final checkout totals

---

# P0-06 — Re-audit tenant isolation after all changes

After implementing the features below, perform another tenant-isolation audit.

Test:

```text
merchant A cannot read merchant B product
merchant A cannot modify merchant B product
merchant A cannot use merchant B coupon
merchant A cannot use merchant B promotion
merchant A cannot read merchant B order
merchant A cannot refund merchant B order
merchant A cannot approve merchant B return
merchant A cannot modify merchant B inventory
merchant A cannot access merchant B fulfillment
merchant A cannot access merchant B warehouse
merchant A cannot access merchant B webhook
```

Add automated regression tests.

---

# P1-01 — Email/no-op delivery correctness

The current no-op mailer must not falsely represent an email as delivered.

If no email provider is configured:

```text
do not report "sent"
```

Use an explicit result such as:

```text
skipped
not_configured
```

or fail startup if email is mandatory for the deployment.

The email log must distinguish:

```text
queued
sending
sent
failed
skipped
```

---

# P1-02 — Customer password reset

Implement complete customer password reset:

```text
forgot password
    ↓
secure single-use token
    ↓
expiry
    ↓
email
    ↓
reset password
    ↓
invalidate token
    ↓
invalidate previous customer sessions
```

Requirements:

- hash stored reset tokens
- short expiration
- one-time use
- no account enumeration
- rate limit
- audit event
- merchant/customer isolation

Do not store raw reset tokens.

---

# P1-03 — Customer email verification

Implement:

```text
register
→ verification token
→ verification email
→ verify
→ mark verified
```

Requirements:

- hashed token
- expiration
- one-time use
- resend limit
- rate limiting
- no user enumeration
- configurable requirement
- audit trail

Do not break existing guest checkout.

---

# P1-04 — Customer address book

Implement customer addresses:

```text
create
list
update
delete
set default shipping
set default billing
```

Fields should support:

```text
name
phone
address lines
city
state
postal code
country
company (optional)
```

### Rules

- customer-scoped
- merchant-scoped
- default address uniqueness
- checkout may use saved address
- deleting default must select another default or leave none
- historical orders must preserve their original address snapshot

Never make historical orders depend on mutable customer addresses.

---

# P1-05 — Fulfillment / shipment system

Create a proper fulfillment model.

Recommended structure:

```text
Order
 ├── Order Items
 └── Fulfillments
       ├── status
       ├── courier
       ├── trackingNumber
       ├── trackingUrl
       ├── labelUrl
       ├── shippedAt
       ├── deliveredAt
       └── metadata
```

Support:

```text
unfulfilled
processing
packed
shipped
delivered
failed
returned
cancelled
```

Prefer a separate fulfillment status instead of overloading order status.

Support future partial fulfillment.

Merchant dashboard must be able to:

```text
create shipment
mark packed
mark shipped
add tracking
mark delivered
cancel fulfillment
```

---

# P1-06 — Courier integration abstraction

Do not hard-code one courier into the order service.

Create:

```ts
ShippingProvider
```

with methods conceptually like:

```text
getRates()
createShipment()
cancelShipment()
getTracking()
generateLabel()
```

Create provider adapters.

Possible providers can be added later without changing order logic.

Persist:

```text
provider
externalShipmentId
trackingNumber
status
request/response metadata where safe
```

Do not store sensitive credentials in plain text.

---

# P1-07 — GST invoicing / credit notes

For India-focused merchants implement:

```text
invoice
invoice number
invoice date
billing address
shipping address
GSTIN
HSN/SAC
taxable value
CGST
SGST
IGST
total tax
grand total
```

Support:

```text
invoice PDF
download
email
credit note
refund document
```

Invoice numbers must be unique per merchant and follow a controlled numbering strategy.

Historical invoices must be immutable.

Do not recalculate old invoices from current product/tax settings.

---

# P1-08 — Pincode serviceability

Create a serviceability abstraction:

```text
pincode
→ serviceable?
→ COD available?
→ shipping fee
→ estimated delivery
```

Do not hard-code serviceability logic into checkout.

Create:

```text
ServiceabilityProvider
```

so a real provider can be integrated later.

Cache results where appropriate.

---

# P1-09 — COD rules

Implement configurable COD rules.

At minimum:

```text
COD enabled/disabled
minimum order value
maximum order value
serviceable pincode
COD fee
```

Design for:

```text
OTP verification
blacklist
fraud scoring
customer COD history
```

COD orders must not be treated as paid before actual payment collection.

---

# P1-10 — Merchant outbound webhooks

Inbound payment/provider webhooks already exist; now implement merchant-facing outbound webhooks.

### Events

```text
order.created
order.paid
order.cancelled
order.shipped
order.delivered
refund.created
refund.completed
return.created
return.approved
product.created
product.updated
inventory.updated
customer.created
fulfillment.created
fulfillment.updated
```

### Merchant webhook model

```text
endpoint
merchantId
url
secret
enabled
events
createdAt
updatedAt
```

### Security

Sign payloads with HMAC.

Example:

```text
X-Webhook-Signature
X-Webhook-Timestamp
X-Webhook-Id
```

Prevent replay attacks.

### Delivery system

Persist:

```text
delivery
attempt
status
responseCode
responseBody
nextRetryAt
lastError
```

Retry with exponential backoff.

Allow manual replay.

---

# P1-11 — Durable background job system

Implement a durable job mechanism for operations that must survive process restarts.

Use the existing database or an appropriate queue; do not introduce unnecessary infrastructure unless needed.

Jobs should support:

```text
email
webhook delivery
abandoned cart
scheduled notifications
invoice generation
cleanup
stock alerts
reconciliation
```

Required:

```text
pending
processing
completed
failed
retry count
next retry
last error
locked/lease timeout
```

Workers must be idempotent.

---

# P1-12 — Abandoned cart

Current cart behaviour must be extended to support persistent abandoned carts.

Implement:

```text
persistent cart
lastActivityAt
customer/guest association
checkout started
checkout completed
abandonedAt
recovery status
```

Flow:

```text
cart
→ inactive for configured period
→ abandoned
→ recovery notification
```

Support recovery links that restore the cart safely.

Do not recover deleted/unavailable products without revalidation.

---

# P2-01 — Multi-warehouse inventory

Add:

```text
warehouses
warehouse_inventory
stock transfers
```

Support:

```text
warehouse create/update/archive
warehouse-specific stock
transfer stock
receive stock
adjust stock
```

Future-ready for:

```text
nearest warehouse
fulfillment warehouse selection
warehouse staff
```

Do not break the current single-stock experience.

Provide a migration/default warehouse strategy.

---

# P2-02 — COGS / profit

Add product/variant cost price.

Calculate:

```text
revenue
discounts
refunds
COGS
gross profit
gross margin
```

Do not call revenue "profit".

Historical order calculations must preserve the cost snapshot used at sale time.

---

# P2-03 — Customer segmentation

Implement reusable segments.

Examples:

```text
new customer
returning customer
high value
inactive
frequent buyer
location
custom segment
```

Segments should be queryable and reusable by marketing features.

Avoid duplicating customer data unnecessarily.

---

# P2-04 — Marketing automation

Create the foundation for:

```text
campaign
audience
template
trigger
schedule
delivery
analytics
```

Potential triggers:

```text
new customer
abandoned cart
first purchase
repeat purchase
inactive customer
birthday if supported
promotion
```

Do not send emails synchronously from checkout.

Use the job system.

---

# P2-05 — Loyalty

Implement optional loyalty points.

Support:

```text
earn rules
redeem rules
balance
ledger
expiry
manual adjustment
```

Use a ledger.

Never store only a mutable balance without transaction history.

Prevent double-spending points under concurrent requests.

---

# P2-06 — Affiliate / referral

Implement:

```text
affiliate
referral code
referral link
click
conversion
commission
payout status
```

Commission must be based on clearly defined eligible order states.

Do not pay commissions for:

```text
cancelled
fully refunded
fraudulent
```

unless policy explicitly says otherwise.

Use immutable attribution records.

---

# P2-07 — CMS

Implement merchant-managed content pages:

```text
About
Contact
FAQ
Privacy
Terms
Shipping policy
Return policy
custom pages
```

Support:

```text
title
slug
content
status
SEO metadata
publishedAt
```

Use sanitized HTML/structured content.

Prevent stored XSS.

---

# P2-08 — Theme / page builder

Build this incrementally.

Start with configurable:

```text
logo
colors
typography
header
footer
homepage sections
navigation
hero
featured products
promotional blocks
```

Use a safe structured JSON schema.

Do not allow arbitrary executable HTML/JS.

Version theme configuration where possible.

---

# P2-09 — Advanced search

Extend current search with:

```text
autocomplete
typo tolerance
synonyms
filters
facets
attribute filters
price range
availability
category
```

Add:

```text
zero-result analytics
search analytics
```

Do not sacrifice tenant isolation.

Search results must respect product publication/status rules.

---

# P2-10 — Merchant API keys / developer platform

JWT dashboard authentication is not a complete public developer API.

Implement:

```text
API key
secret
scopes
createdAt
lastUsedAt
expiresAt
revokedAt
```

Recommended scopes:

```text
products:read
products:write
orders:read
orders:write
customers:read
inventory:read
inventory:write
webhooks:read
webhooks:write
```

Store only hashed secrets where practical.

Show the secret once.

Support rotation and revocation.

Add API versioning:

```text
/api/v1/...
```

Add rate limiting.

---

# CROSS-CUTTING SECURITY REQUIREMENTS

All new features must follow these.

## Authentication

Do not bypass existing authentication/authorization.

## Authorization

Merchant owner/staff permissions must be enforced.

## Tenant isolation

Every merchant-owned query must be scoped.

## Input validation

Validate all request bodies.

Do not trust frontend values.

## SQL safety

Use Drizzle parameterized queries.

Never concatenate user input into SQL.

## XSS

Sanitize CMS/content-builder HTML.

## SSRF

Webhook/courier URLs must be validated where server-side requests are made.

## Secrets

Never return:

```text
API secrets
payment secrets
webhook signing secrets
reset tokens
private credentials
```

## Rate limits

Add appropriate limits for:

```text
login
password reset
email verification
public order lookup
coupon application
checkout
webhooks
API keys
```

---

# DATABASE REQUIREMENTS

Every new business entity must have:

```text
id
merchantId where applicable
createdAt
updatedAt
```

Use foreign keys where appropriate.

Use unique constraints for:

```text
merchant + slug
merchant + code
merchant + invoice number
merchant + API key identifier
merchant + webhook endpoint constraints
```

Use indexes for:

```text
merchantId
status
createdAt
foreign keys
lookup tokens
tracking numbers
```

Avoid unnecessary indexes.

---

# API DESIGN REQUIREMENTS

Keep API behaviour consistent.

Use:

```text
validation
authorization
service/domain operation
transaction
response
```

Do not put complex business logic directly in route handlers.

Return safe public representations.

Do not expose internal database fields unnecessarily.

---

# FRONTEND REQUIREMENTS

For every new feature:

```text
loading state
empty state
error state
success feedback
validation
permission handling
mobile usability
```

Do not implement UI-only fake features.

Every visible control must connect to a real API operation.

Do not show a feature as complete if the backend is not complete.

---

# TEST REQUIREMENTS

## Mandatory P0 concurrency tests

Add automated tests for:

```text
100 concurrent checkouts on limited stock
20 concurrent refunds
20 concurrent return approvals
20 concurrent cancellations
checkout + cancellation race
checkout + return race
return + cancellation race
refund + cancellation race
```

Verify final database state, not merely HTTP responses.

---

# Tenant isolation tests

At minimum:

```text
merchant A product vs merchant B
merchant A variant vs merchant B
merchant A coupon vs merchant B
merchant A promotion vs merchant B
merchant A order vs merchant B
merchant A refund vs merchant B
merchant A return vs merchant B
merchant A inventory vs merchant B
merchant A fulfillment vs merchant B
merchant A warehouse vs merchant B
merchant A webhook vs merchant B
merchant A customer vs merchant B
```

---

# State-machine tests

Test all valid and invalid transitions.

### Orders

```text
pending → processing
pending → cancelled
processing → shipped
processing → cancelled
shipped → delivered
```

Reject invalid transitions.

Refund states must not be manually mutated through generic order status APIs.

---

# Refund tests

```text
full refund
partial refund
multiple partial refunds
over-refund rejection
concurrent refund
failed gateway refund
provider timeout
retry
duplicate webhook
provider reconciliation
```

---

# Return tests

```text
valid return
duplicate return
excess quantity
cancelled order
concurrent approval
restock exactly once
reject
refund after approval
```

---

# Inventory tests

```text
sale
cancel
return
manual adjustment
CSV import
bulk update
variant update
concurrent update
negative stock protection
```

---

# Promotion tests

```text
active
expired
future
disabled
product scope
category scope
all scope
promotion + coupon
usage limit
concurrent usage
cross-merchant
negative total
```

---

# Feature acceptance criteria

A feature is NOT considered complete merely because:

```text
database table exists
API route exists
dashboard button exists
CRUD works
```

It is complete only when:

```text
database
+
service/business logic
+
API
+
authorization
+
frontend
+
validation
+
error handling
+
tests
+
migration
```

are all implemented where applicable.

---

# MIGRATION REQUIREMENTS

For every schema change:

1. Create a proper Drizzle migration.
2. Update schema definitions.
3. Ensure migration works on an existing database.
4. Do not delete existing production data.
5. Provide sensible defaults/backfill.
6. Verify rollback strategy where practical.
7. Update seed data if required.
8. Run migration validation.

Do not modify old migration files unless absolutely necessary.

---

# IMPLEMENTATION WORKFLOW

Follow this exact workflow.

## Step 1 — Inspect

Before changing anything:

```text
inspect repository
inspect database schema
inspect migrations
inspect existing services
inspect routes
inspect frontend
inspect tests
```

Do not assume a feature is missing until the existing implementation has been checked.

---

## Step 2 — Map dependencies

For each feature identify:

```text
DB tables
migration
service
routes
schemas/validation
frontend
permissions
jobs
events
tests
```

---

## Step 3 — Implement P0 first

Do not start the 21 feature gaps until the critical state-machine issues are corrected.

---

## Step 4 — Implement P1

Complete the core production commerce layer.

---

## Step 5 — Implement P2

Implement advanced features incrementally.

---

## Step 6 — Test

Run:

```bash
bun install
bun run check
bun run typecheck
bun run test
bun run lint
bun run build
```

Also run database migration checks.

If the project uses different commands for a workspace, use the existing repository scripts rather than inventing a parallel toolchain.

---

# DO NOT HIDE FAILURES

If something cannot be completed:

Do NOT:

- fake success
- create placeholder APIs
- return hardcoded data
- silently ignore errors
- mark incomplete features as enabled
- add TODO comments and call it complete

Instead report:

```text
BLOCKED
REASON
WHAT WAS IMPLEMENTED
WHAT REMAINS
```

---

# FINAL VERIFICATION CHECKLIST

Before declaring the work complete, verify:

## P0

- [ ] cancellation has one authoritative path
- [ ] generic status endpoint cannot bypass cancellation
- [ ] paid orders cannot be silently cancelled
- [ ] refund cannot become completed without valid settlement
- [ ] refund idempotency exists
- [ ] refund reconciliation exists for uncertain provider state
- [ ] return approval cannot double-restock
- [ ] cancellation cannot double-restock
- [ ] inventory updates are concurrency safe everywhere
- [ ] promotion calculation is server-side
- [ ] promotion + coupon totals are correct
- [ ] tenant isolation tests pass

## P1

- [ ] email no-op is explicit
- [ ] password reset
- [ ] email verification
- [ ] customer address book
- [ ] fulfillment
- [ ] shipment/tracking
- [ ] courier abstraction
- [ ] GST invoice
- [ ] credit note
- [ ] pincode serviceability abstraction
- [ ] COD rules
- [ ] merchant outbound webhooks
- [ ] webhook signatures
- [ ] webhook retry system
- [ ] durable jobs
- [ ] abandoned cart

## P2

- [ ] multi-warehouse
- [ ] COGS/profit
- [ ] customer segmentation
- [ ] marketing automation
- [ ] loyalty
- [ ] affiliate/referral
- [ ] CMS
- [ ] theme/page builder
- [ ] advanced search
- [ ] API keys/developer platform

---

# FINAL REPORT REQUIRED FROM THE IMPLEMENTATION AGENT

After implementation, return a concise report with:

## 1. Files changed

```text
path/to/file — what changed
```

## 2. Migrations added

```text
migration — purpose
```

## 3. P0 fixes

For each:

```text
fixed
files
tests
```

## 4. P1 features

For each:

```text
implemented
files
API
UI
tests
```

## 5. P2 features

Same format.

## 6. Tests executed

Include exact commands and results.

Example:

```text
bun run check       PASS
bun run typecheck   PASS
bun run test        PASS
bun run lint        PASS
bun run build       PASS
```

Never claim PASS if the command was not actually executed.

## 7. Remaining blockers

List only real blockers.

## 8. Payment demo

Explicitly state:

```text
Payment demo behaviour was intentionally left unchanged per scope.
```

---

# DEFINITION OF DONE

The implementation is complete only when:

```text
Existing functionality preserved
        +
P0 correctness issues closed
        +
21 feature gaps implemented according to priority
        +
tenant isolation verified
        +
concurrency tests added
        +
database migrations valid
        +
frontend connected to real APIs
        +
typecheck passes
        +
tests pass
        +
build passes
```

Do not rewrite the project.

Do not touch the demo payment implementation.

Do not mark incomplete functionality as complete.

Work incrementally, keep the existing architecture, and verify every business-state transition.
