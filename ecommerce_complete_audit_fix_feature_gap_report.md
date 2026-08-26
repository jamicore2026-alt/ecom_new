# E-commerce Project — Complete Audit, Fix Plan & Feature Gap Report

**Project:** `ecom_new-main`  
**Audit scope:** Source-code architecture, API, database/schema, storefront, merchant dashboard, authentication, checkout, inventory, orders, returns/refunds, payments, uploads, deployment/CI, and feature completeness.  
**Important scope note:** The demo payment behaviour (`card → paid`) is intentionally excluded from this report because it is a temporary demo implementation and will be fixed later. It is **not counted as a current blocker** below.

---

## 1. Executive Summary

The project has a solid ecommerce foundation and does **not** need to be restarted from scratch.

The current implementation is roughly:

- **MVP ecommerce functionality:** substantially implemented
- **Architecture:** good foundation
- **Production correctness:** not ready yet
- **Main technical risk:** state consistency between **Order ↔ Payment ↔ Refund ↔ Return ↔ Inventory ↔ Coupon**
- **Main product gap:** fulfillment, promotions, customer/account completeness, invoicing, integrations, advanced inventory, marketing, and SaaS/developer capabilities

### Overall assessment

| Area | Assessment |
|---|---|
| Architecture | Good |
| API structure | Good |
| Multi-tenancy | Good foundation, needs hardening |
| Authentication | Good foundation |
| Checkout | Mostly implemented, concurrency fixes needed |
| Inventory | Implemented, but several race conditions remain |
| Orders | Implemented, state transitions need tightening |
| Payments | Provider architecture is good; demo behaviour intentionally excluded |
| Refunds | Implemented, but concurrency/state correctness needs work |
| Returns | Implemented, but concurrency/state correctness needs work |
| Storefront | Strong MVP coverage |
| Merchant dashboard | Strong MVP coverage |
| Analytics | Basic/medium |
| Production readiness | **Not ready yet** |
| Feature completeness | **MVP mostly complete; production SaaS/advanced ecommerce incomplete** |

---

# 2. Critical Fixes

These are the fixes that should be completed before treating the application as production-ready.

## P0 — Critical

### P0-01 — Cross-merchant checkout isolation

**Area:** Storefront checkout / multi-tenancy

`resolveItems()` loads products and variants by IDs but does not consistently enforce that every product belongs to the current merchant.

### Risk

A checkout request may potentially combine identifiers from another merchant with the current store's checkout.

### Required fix

Every checkout product/variant lookup must be scoped to:

```text
merchantId = currentMerchantId
```

Also verify:

```text
variant.productId === product.id
product.merchantId === currentMerchantId
```

and ideally reinforce tenant ownership with database constraints where practical.

**Priority:** P0  
**Status:** Fix required

---

### P0-02 — Unify order cancellation paths

There are separate paths for:

- changing order status to `cancelled`
- dedicated order cancellation

These paths do not perform the same business operations.

### Risk

One cancellation path may:

- restore inventory
- restore coupon usage
- handle payment state

while another only changes the status.

### Required fix

There should be one authoritative cancellation service.

All UI/API cancellation operations must call the same domain operation.

The cancellation operation should atomically handle:

```text
order state
inventory restoration
coupon usage restoration
payment/refund state
audit event
```

**Priority:** P0  
**Status:** Fix required

---

### P0-03 — Do not mark a paid order refunded without an actual refund

Current cancellation/refund state handling can make the database appear refunded without guaranteeing the payment gateway has actually returned the money.

### Required fix

Separate:

```text
refund requested
refund processing
refund succeeded
refund failed
```

The order/payment state must only become fully refunded after successful provider confirmation.

For asynchronous providers, persist a refund record and reconcile via webhook/status polling.

**Priority:** P0  
**Status:** Fix required

---

### P0-04 — Prevent direct `delivered → refunded` state mutation

Refund must be a domain operation, not merely an order-status update.

### Required fix

Do not allow:

```text
status = refunded
```

through generic order-status mutation.

Instead:

```text
createRefund()
    ↓
provider refund
    ↓
refund record
    ↓
order/payment state update
```

**Priority:** P0  
**Status:** Fix required

---

### P0-05 — Make refunds concurrency-safe

Current refund flow effectively does:

```text
read previous refunds
calculate remaining
create refund
update order
```

Two simultaneous refund requests can potentially both see the same remaining amount.

### Required fix

Use a transaction with an order/refund lock or an atomic reservation mechanism.

Conceptually:

```text
BEGIN

SELECT order/refund state FOR UPDATE

calculate refundable amount

validate requested amount

create refund reservation

COMMIT
```

Only one concurrent operation should be able to consume the same refundable balance.

**Priority:** P0  
**Status:** Fix required

---

### P0-06 — Prevent return approval from double-restocking

Current return approval checks `pending`, then restocks, then updates status.

Two simultaneous approvals can both restock.

### Required fix

Atomically claim the return:

```sql
UPDATE returns
SET status = 'approved'
WHERE id = ?
  AND status = 'pending'
RETURNING *;
```

Only the transaction that successfully changes `pending → approved` may restock.

**Priority:** P0  
**Status:** Fix required

---

# 3. High-Priority Correctness Fixes

## P1-01 — Prevent returns on cancelled orders

A cancelled order may already have restored inventory.

A pending return associated with the same order must not later restore the same inventory again.

### Fix

Return approval must validate the current order state.

**Priority:** P1

---

## P1-02 — Prevent duplicate return quantities

Return creation calculates:

```text
purchased quantity - already returned quantity
```

but the calculation and insert are not sufficiently atomic.

### Risk

Two concurrent return requests can both reserve the same quantity.

### Fix

Lock the order/line or use an atomic return-quantity reservation.

**Priority:** P1

---

## P1-03 — Fix absolute inventory update race

Dashboard inventory updates read a quantity and later write an absolute value.

A checkout can modify the quantity between those operations.

Example:

```text
Stock = 10

Dashboard reads 10
Checkout → 9

Dashboard writes 8
```

The checkout decrement is lost.

### Fix

For absolute inventory changes:

```text
BEGIN
SELECT variant FOR UPDATE
calculate new value
UPDATE variant
INSERT inventory log
COMMIT
```

**Priority:** P1

---

## P1-04 — Fix CSV inventory import race

CSV inventory updates have the same class of problem as dashboard inventory edits.

### Fix

Use row locking/atomic inventory mutations during import.

**Priority:** P1

---

## P1-05 — Fix bulk `set_inventory` race

Bulk inventory updates must use the same concurrency-safe inventory service as normal inventory changes.

Do not maintain separate unsafe mutation logic.

**Priority:** P1

---

## P1-06 — Fix `store_credit` / `credit` refund implementation

Refund methods expose store-credit-like options, but a complete wallet/credit ledger is not implemented.

### Fix

Either:

1. implement a proper wallet/credit system, or
2. remove/disable those refund methods until implemented.

A successful refund record must correspond to an actual customer credit.

**Priority:** P1

---

## P1-07 — Prevent the same return from being refunded multiple times

Refund creation validates the return relationship but needs a stronger state check.

### Fix

A return can only be refunded once unless the business explicitly supports partial/multiple refunds.

Use:

```text
approved → refund pending → refunded
```

or a clear partial-refund state model.

**Priority:** P1

---

## P1-08 — Restore coupon usage on cancellation

Some expiry/provider flows restore coupon usage, but normal cancellation does not consistently perform the same operation.

### Fix

Centralize coupon usage accounting inside the order state machine.

**Priority:** P1

---

# 4. Checkout / Pricing Fixes

## P1-09 — Fix checkout-preview request contract

The storefront sends shipping-country/address information, while the preview schema does not fully model the same data.

### Fix

Define one shared checkout contract used by:

```text
storefront
API schema
preview
final checkout
```

Avoid frontend/backend contract drift.

**Priority:** P1

---

## P1-10 — Do not silently select the first shipping zone

Current fallback behaviour can use the first configured zone when no proper match exists.

### Risk

A customer from an unsupported country could receive the wrong shipping rate.

### Fix

Use:

```text
matching zone
OR explicit default zone
OR reject unsupported country
```

Never silently assume `zones[0]`.

**Priority:** P1

---

## P1-11 — Implement actual regional tax selection

Tax settings can represent multiple regions, but checkout must actually select the correct rate from the customer's applicable region.

### Fix

Create explicit tax resolution:

```text
country
state/province
postal code
merchant tax configuration
```

→ applicable tax rate.

**Priority:** P1

---

# 5. Promotions

## P1-12 — Promotion CRUD exists, but promotion application is incomplete

The dashboard can manage promotions, but checkout does not fully apply a promotion engine.

### Missing/required

- percentage discount
- fixed discount
- product-level promotion
- category-level promotion
- minimum cart amount
- customer-specific promotion
- first-order promotion
- buy-X-get-Y
- free shipping promotion
- start/end scheduling
- usage limit
- per-customer limit
- stacking rules
- priority rules

### Recommendation

Do not advertise Promotions as fully implemented until checkout application is complete.

**Priority:** P1

---

# 6. Customer / Account Gaps

## P1-13 — Password reset

Need complete:

```text
Forgot password
→ reset token
→ email
→ reset password
→ invalidate old sessions
```

**Priority:** P1

---

## P1-14 — Email verification

Recommended customer flow:

```text
register
→ verification email
→ verify
→ account active
```

**Priority:** P1/P2 depending on business policy

---

## P2-01 — Customer address book

Missing/limited:

- saved addresses
- multiple addresses
- default address
- edit/delete
- billing address
- shipping address selection

**Priority:** P2

---

## P2-02 — Saved payment methods

Customer account does not provide a complete saved-payment-method management system.

Potential features:

- saved cards
- default payment method
- remove payment method

Only implement this through provider tokenization; never store raw card data.

**Priority:** P2

---

# 7. Public Order / Privacy

## P1-15 — Harden public order lookup

Public order lookup exposes meaningful order/shipping information.

### Improve with

- high-entropy public lookup token
- order number + email verification
- rate limiting
- minimal public response
- do not expose internal notes
- avoid unnecessary PII

**Priority:** P1

---

# 8. Email / Notification Infrastructure

## P2-03 — No-op email must not report success

If no real mail provider is configured, a no-op mailer currently behaves like successful delivery.

### Fix

Production should either:

```text
fail startup if email is required
```

or log:

```text
skipped / not configured
```

Never:

```text
sent
```

**Priority:** P1/P2

---

## P2-04 — Durable email queue

Current email delivery is effectively fire-and-forget.

### Needed

- durable queue
- retries
- exponential backoff
- dead-letter/failure state
- delivery logs
- retry UI/operation

Possible implementation:

```text
pg-boss
Redis queue
external queue
```

**Priority:** P2

---

# 9. Fulfillment — Major Feature Gap

This is one of the biggest product gaps.

Current order statuses do not equal a real fulfillment system.

## Missing

- fulfillment records
- shipment creation
- courier assignment
- tracking number
- tracking URL
- shipment status
- package information
- shipment timestamps
- partial shipments
- multiple packages
- failed delivery
- return-to-origin
- fulfillment notes

### Recommended model

```text
Order
 ├── Fulfillment
 │    ├── courier
 │    ├── trackingNumber
 │    ├── trackingUrl
 │    ├── status
 │    ├── shippedAt
 │    └── deliveredAt
 └── Order Items
```

**Priority:** P1

---

# 10. Courier / Shipping Integrations — Feature Gap

No mature courier integration layer.

Potential integrations:

- Shiprocket
- Delhivery
- DTDC
- Blue Dart
- DHL
- FedEx
- Easyship

The exact provider list should depend on target markets.

### Required architecture

```text
ShippingProviderAdapter
    ├── createShipment()
    ├── cancelShipment()
    ├── getTracking()
    ├── generateLabel()
    └── getRates()
```

**Priority:** P2, or P1 for India-focused production

---

# 11. Abandoned Cart — Feature Gap

Current cart is primarily client-side.

Missing:

- persistent customer cart
- abandoned-cart detection
- merchant abandoned-cart dashboard
- recovery links
- recovery coupons
- email reminders
- abandoned-cart analytics

### Recommended flow

```text
Customer cart
    ↓
persistent cart
    ↓
no checkout for X hours
    ↓
abandoned cart
    ↓
notification/recovery
```

**Priority:** P2

---

# 12. Outbound Merchant Webhooks — Feature Gap

Payment webhooks exist as inbound provider integrations.

Merchant-facing outbound webhooks are missing.

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
product.updated
inventory.updated
customer.created
```

### Needed

- webhook endpoint management
- event subscriptions
- signing secret
- HMAC signature
- retry
- backoff
- delivery logs
- replay
- test event

**Priority:** P1/P2

---

# 13. Inventory — Advanced Feature Gap

Basic inventory exists.

Missing advanced capabilities:

- multiple warehouses
- warehouse-specific stock
- stock transfer
- stock receiving
- damaged stock
- lost stock
- stock reservation lifecycle
- purchase orders
- supplier management
- reorder points
- preferred supplier
- inventory valuation
- batch/lot tracking

**Priority:** P2

---

# 14. Multi-Warehouse — Feature Gap

Current inventory is essentially one stock pool per variant.

Needed for larger merchants:

```text
Warehouse A → SKU → quantity
Warehouse B → SKU → quantity
Warehouse C → SKU → quantity
```

Also:

- warehouse selection
- nearest-warehouse fulfillment
- transfers
- warehouse users
- warehouse reports

**Priority:** P2

---

# 15. Invoicing / GST — Feature Gap

For Indian merchants this is particularly important.

Missing/limited:

- invoice numbering
- invoice PDF
- billing address
- GSTIN
- GST tax breakdown
- CGST
- SGST
- IGST
- HSN/SAC
- credit notes
- refund/credit-note documents
- invoice download
- invoice email

**Priority:** P1 for India-focused merchant SaaS

---

# 16. Product Import / Export — Feature Gap

Missing complete merchant bulk product operations:

- CSV import
- CSV export
- update by SKU
- variant import
- category mapping
- validation report
- failed-row report
- image mapping

**Priority:** P1/P2

---

# 17. Order Export — Feature Gap

Useful merchant capability:

- CSV export
- date-range export
- filtered export
- selected-order export
- customer/order/item data export

**Priority:** P2

---

# 18. Customer Import / Export — Feature Gap

Missing:

- customer CSV export
- customer CSV import
- duplicate handling
- field mapping

**Priority:** P2

---

# 19. Analytics — Feature Gap

Current analytics are useful but basic.

Missing advanced metrics:

- AOV
- repeat purchase rate
- customer retention
- LTV
- cohort analysis
- checkout funnel
- abandoned-cart rate
- refund rate
- cancellation rate
- discount impact
- payment-method performance
- product profitability
- shipping revenue
- tax collected

**Priority:** P2

---

# 20. Profit / COGS — Feature Gap

Current model focuses on selling price/revenue.

Missing:

```text
cost price
COGS
gross profit
gross margin %
net profit
```

### Example

```text
Selling price: ₹1,000
COGS: ₹600
Gross profit: ₹400
Margin: 40%
```

**Priority:** P1/P2 for serious merchant analytics

---

# 21. Customer Segmentation — Feature Gap

Missing:

- new customers
- returning customers
- high-value customers
- inactive customers
- purchase-frequency segments
- location segments
- custom segments

**Priority:** P2

---

# 22. Marketing Automation — Feature Gap

Missing:

- email campaigns
- promotional campaigns
- customer targeting
- campaign analytics
- coupon campaigns
- automated customer journeys

**Priority:** P3

---

# 23. Loyalty / Rewards — Feature Gap

Missing:

- points
- earning rules
- redemption
- tiers
- expiry
- loyalty history

**Priority:** P3

---

# 24. Referral / Affiliate — Feature Gap

Missing:

- affiliate accounts
- referral links/codes
- commission tracking
- conversion attribution
- payouts
- affiliate dashboard

**Priority:** P3

---

# 25. Product SEO Management — Feature Gap

Technical SEO exists, but merchant-controlled SEO needs:

- SEO title
- meta description
- canonical URL
- OG title
- OG description
- OG image
- custom slug
- redirects

**Priority:** P2

---

# 26. CMS / Custom Pages — Feature Gap

Missing proper CMS pages:

- About
- Contact
- FAQ
- Privacy
- Terms
- Shipping policy
- Return policy
- custom landing pages
- blog/content pages

**Priority:** P2

---

# 27. Storefront Theme / Page Builder — Feature Gap

Current storefront is not a Shopify-style visual builder.

Potential features:

- homepage sections
- drag/drop blocks
- hero banners
- promotional blocks
- theme selection
- colors
- typography
- header/footer builder
- navigation builder
- custom sections

**Priority:** P2/P3

---

# 28. Navigation Management — Feature Gap

Missing merchant-managed:

- header menus
- footer menus
- category menus
- custom links
- mega menus

**Priority:** P2

---

# 29. Product Attributes / Advanced Variants — Feature Gap

Current variants are functional but can be expanded to:

- option groups
- Color
- Size
- Material
- automatic variant generation
- variant-specific images
- barcode
- SKU
- weight
- dimensions
- cost
- compare-at price

**Priority:** P2

---

# 30. Reviews — Advanced Feature Gap

Current review functionality is basic.

Potential improvements:

- verified-purchase enforcement
- rating breakdown
- review images
- review videos
- helpful votes
- merchant replies
- review request emails
- spam detection
- review analytics

**Priority:** P2/P3

---

# 31. Wishlist / Back-in-Stock

Wishlist exists, but advanced customer intent features are missing:

- save-for-later
- share wishlist
- price-drop notification
- back-in-stock notification
- wishlist email

**Priority:** P2

---

# 32. Recommendations — Feature Gap

Missing:

- frequently bought together
- cross-sell
- upsell
- recently viewed
- similar products
- personalized recommendations

**Priority:** P3

---

# 33. Search — Advanced Feature Gap

Basic full-text search exists.

Missing:

- autocomplete
- typo tolerance
- synonyms
- search ranking controls
- faceted search
- attribute filters
- zero-result analytics
- search analytics

**Priority:** P2

---

# 34. COD Management — Feature Gap

For India, mature COD needs:

- COD fee
- COD availability rules
- pincode restrictions
- order value limits
- OTP confirmation
- fraud controls
- blacklist
- reconciliation

**Priority:** P1/P2 for India

---

# 35. Pincode Serviceability — Feature Gap

India-specific:

```text
Pincode
→ serviceable?
→ COD available?
→ shipping fee?
→ estimated delivery?
```

Not implemented.

**Priority:** P1 for India

---

# 36. Delivery ETA — Feature Gap

Missing calculated:

```text
Expected delivery:
Aug 29 – Sep 1
```

based on:

- pincode
- warehouse
- courier
- handling time

**Priority:** P2

---

# 37. Returns Policy Engine — Feature Gap

Current return workflow exists, but policy rules are not a full engine.

Missing:

- return window
- category rules
- non-returnable products
- reason-specific eligibility
- restocking fee
- return shipping responsibility
- automatic eligibility calculation

**Priority:** P2

---

# 38. Customer Support — Feature Gap

Missing:

- support tickets
- ticket assignment
- status
- internal notes
- customer conversation history
- support dashboard

Could alternatively integrate an external helpdesk rather than building this internally.

**Priority:** P3

---

# 39. Merchant API Keys / Developer Platform — Feature Gap

JWT authentication is not the same as merchant integration credentials.

Missing:

- API keys
- secret rotation
- scopes
- revocation
- last-used information
- API documentation
- versioned public API

**Priority:** P2/P3

---

# 40. Job / Worker Infrastructure — Feature Gap

A durable general job system would support:

- abandoned carts
- email delivery
- webhook retries
- scheduled promotions
- reports
- notifications
- cleanup
- stock alerts

Potential solution:

```text
pg-boss
Redis/BullMQ
external queue
```

**Priority:** P2

---

# 41. Security / Infrastructure Hardening

## P1/P2 items

### Access token in localStorage

Dashboard access token is stored in localStorage.

Risk:

```text
XSS
↓
token theft
```

Prefer stronger browser-session architecture where practical.

---

### Refresh token exposed to JavaScript

If refresh token is already in an HttpOnly cookie, returning it in JSON to browser clients is unnecessary.

Keep browser refresh tokens HttpOnly.

---

### In-memory rate limiter

Current memory-based rate limiting does not scale across multiple API instances.

For multi-instance deployment use a shared store or edge/proxy rate limiting.

---

### Upload persistence

Local uploads must use a persistent Coolify volume or object storage.

Recommended production architecture:

```text
S3 / Cloudflare R2 / MinIO
```

rather than relying on container filesystem.

---

# 42. Database / Tenant Hardening

Application-level tenant checks are present in many places.

Still recommended:

- composite tenant constraints
- tenant-aware unique constraints
- merchant ownership validation
- consistent merchant_id on business entities
- DB-level defence-in-depth

Particularly important for:

```text
products
categories
variants
orders
returns
refunds
inventory
webhook events
```

---

# 43. CI/CD Gaps

Current CI should be expanded.

Recommended pipeline:

```text
Install
↓
Lint
↓
Typecheck
↓
Svelte check
↓
Unit tests
↓
Integration tests
↓
Concurrency tests
↓
Dependency audit
↓
Secret scan
↓
Docker build
↓
Migration validation
↓
Deploy
```

### Particularly important missing tests

```text
100 concurrent checkouts
20 concurrent refunds
20 concurrent returns
20 concurrent cancellations
cross-merchant checkout attempts
inventory import during checkout
duplicate webhook delivery
duplicate payment callback
```

---

# 44. Feature Classification

## Tier 1 — Current MVP / already substantially implemented

```text
Store
Products
Variants
Categories
Search
Cart
Checkout
Coupons
Orders
Inventory
Customers
Reviews
Wishlist
Payments
Returns
Refunds
Analytics
Staff
Permissions
Settings
SEO
Multi-tenancy
```

## Tier 2 — Production-ready merchant SaaS

```text
Fulfillment
Courier integrations
Promotions engine
Invoice/GST
Customer password reset
Address book
Email automation
Product import/export
Order export
Outbound webhooks
Advanced inventory
COGS/profit
Pincode serviceability
COD management
```

## Tier 3 — Advanced ecommerce

```text
Multi-warehouse
Loyalty
Affiliate
Marketing automation
Recommendations
Advanced search
Multi-currency
Multi-language
CMS
Theme/page builder
Customer segmentation
Support system
Developer platform
```

---

# 45. Recommended Implementation Order

Do **not** implement all feature gaps immediately.

## Phase 1 — Correctness / safety

```text
1. Cross-merchant checkout isolation
2. Unified cancellation service
3. Refund state correctness
4. Refund concurrency
5. Return concurrency
6. Cancelled-order return protection
7. Inventory concurrency
8. Coupon accounting consistency
9. Checkout contract consistency
10. Shipping-zone correctness
11. Tax-region correctness
12. Public order privacy
```

## Phase 2 — Core production commerce

```text
13. Fulfillment model
14. Shipment/tracking
15. Courier abstraction
16. Promotion engine
17. Invoice/GST
18. Customer password reset
19. Customer email verification
20. Address book
21. Product import/export
22. Order export
23. Merchant outbound webhooks
24. Durable email/job queue
```

## Phase 3 — India-focused capabilities

```text
25. Razorpay/Cashfree/PhonePe/etc. as required
26. UPI
27. GST
28. Pincode serviceability
29. COD rules
30. Shiprocket/courier integration
31. WhatsApp/SMS notifications
32. Delivery ETA
```

## Phase 4 — Advanced merchant platform

```text
33. Multi-warehouse
34. COGS/profit
35. Advanced analytics
36. Customer segmentation
37. Marketing automation
38. Loyalty
39. Affiliate/referral
40. Advanced search
41. Product recommendations
42. CMS
43. Theme/page builder
44. Developer/API platform
```

---

# 46. What NOT to do

Do not restart the project.

Do not rewrite the whole architecture.

Do not add 40 features before fixing state consistency.

Do not expose incomplete features as production-ready.

Do not make inventory/order/payment state changes from multiple independent controllers.

Use central domain services for:

```text
Order lifecycle
Inventory lifecycle
Refund lifecycle
Return lifecycle
Coupon lifecycle
Payment lifecycle
Fulfillment lifecycle
```

The key architectural rule should be:

> **One business operation = one authoritative service + one transaction/state transition.**

---

# 47. Final Verdict

The project is **not a failed project**.

It has a good base and most of the core MVP ecommerce flow is already present.

The work remaining falls into three categories:

### A. Must fix

```text
Tenant isolation
Order state consistency
Refund concurrency
Return concurrency
Inventory concurrency
Coupon consistency
Tax/shipping correctness
Public order privacy
```

### B. Must add for a serious production SaaS

```text
Fulfillment
Promotions engine
Invoices/GST
Courier integration
Abandoned cart
Merchant webhooks
Customer account completion
Import/export
Durable jobs/email
Advanced inventory
Profit/COGS
```

### C. Future differentiation

```text
Multi-warehouse
Marketing automation
Loyalty
Affiliate
Recommendations
CMS
Theme builder
Advanced analytics
Developer platform
```

---

## Final recommendation

**Current project → keep it.**

Do the implementation in this order:

```text
Existing code
    ↓
Fix P0/P1 correctness
    ↓
Complete core production commerce
    ↓
India-specific commerce features
    ↓
Advanced SaaS features
```

The architecture is worth continuing. The main work now is **hardening the business state machine and filling product gaps**, not rebuilding the application.
