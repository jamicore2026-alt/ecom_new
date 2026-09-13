# Tenant-Scope Inventory

**Generated:** September 11, 2026 · **Source:** `apps/api/src/database/schema.ts`

Every table classified by tenant ownership. This satisfies SaaS audit P0 work item #1
("build a tenant-scope inventory from the schema and classify every table").

Classification rules:

- **Platform** (2) — no tenant ownership. `merchants` is the tenant root itself;
  `webhook_events` is the provider event inbox (provider-region, not merchant-region).
- **Merchant** (61) — a `merchantId` column. 7 child tables own merchant scope
  *indirectly* through a parent FK (marked "via …").
- **Outlet** (11) — `merchantId` + `outletId`. Operational rows partitioned per
  outlet, including child `order_items` (inherits the `orders` outlet scope).
- **User** (2) — employee-scoped identity (`users` stays Merchant; `drivers` and
  `token_blacklist` are keyed to a single user).
- **Customer** (10) — shopper-scoped rows (`merchantId` + `customerId`).

## Inventory

**Platform (2)**

| Table | Schema var | Line | Scope keys |
|---|---|---|---|
| `merchants` | merchants | 34 | - |
| `webhook_events` | webhookEvents | 1061 | - |

**Merchant (61)**

| Table | Schema var | Line | Scope keys |
|---|---|---|---|
| `affiliates` | affiliates | 1755 | merchantId |
| `api_keys` | apiKeys | 1815 | merchantId |
| `audit_logs` | auditLogs | 870 | merchantId |
| `background_jobs` | backgroundJobs | 1229 | merchantId |
| `bill_of_materials` | billOfMaterials | 1558 | merchantId |
| `bom_items` (via bill_of_materials+product_variants) | bomItems | 1580 | - |
| `campaigns` | campaigns | 1927 | merchantId |
| `carriers` | carriers | 1911 | merchantId |
| `categories` | categories | 254 | merchantId |
| `checkout_settings` | checkoutSettings | 1868 | merchantId |
| `cod_rules` | codRules | 1896 | merchantId |
| `content_pages` | contentPages | 1795 | merchantId |
| `coupons` | coupons | 944 | merchantId |
| `customer_segments` | customerSegments | 1649 | merchantId |
| `customers` | customers | 369 | merchantId |
| `driver_assignments` | driverAssignments | 805 | merchantId |
| `driver_locations` | driverLocations | 754 | merchantId |
| `email_logs` | emailLogs | 1140 | merchantId |
| `food_order_items` | foodOrderItems | 504 | merchantId |
| `fulfillments` | fulfillments | 1255 | merchantId |
| `goods_receipts` | goodsReceipts | 1510 | merchantId |
| `goodsReceiptItems` (via goods_receipts+purchaseOrderItems+product_variants) | goodsReceiptItems | 1534 | - |
| `inventory_logs` | inventoryLogs | 349 | merchantId |
| `invoices` | invoices | 1344 | merchantId |
| `kitchenTicketItems` | kitchenTicketItems | 675 | merchantId |
| `loyalty_rewards` | loyaltyRewards | 1736 | merchantId |
| `loyalty_tiers` | loyaltyTiers | 1703 | merchantId |
| `loyaltyEarningRules` | loyaltyEarningRules | 1719 | merchantId |
| `menu_items` | menuItems | 145 | merchantId |
| `menuItemModifiers` | menuItemModifiers | 212 | merchantId |
| `merchant_modules` | merchantModules | 92 | merchantId |
| `modifier_groups` | modifierGroups | 172 | merchantId |
| `modifiers` | modifiers | 189 | merchantId |
| `notificationSettings` | notificationSettings | 1117 | merchantId |
| `outlets` | outlets | 72 | merchantId |
| `payment_settings` | paymentSettings | 1001 | merchantId |
| `paymentProviderConfigs` | paymentProviderConfigs | 1020 | merchantId |
| `paymentTransactions` | paymentTransactions | 1038 | merchantId |
| `product_images` (via products) | productImages | 334 | - |
| `product_variants` (via products) | productVariants | 307 | - |
| `production_orders` | productionOrders | 1599 | merchantId |
| `productionOrderItems` (via production_orders+product_variants) | productionOrderItems | 1625 | - |
| `products` | products | 272 | merchantId |
| `promotions` | promotions | 963 | merchantId |
| `purchase_orders` | purchaseOrders | 1462 | merchantId |
| `purchaseOrderItems` (via purchase_orders+product_variants) | purchaseOrderItems | 1489 | - |
| `refunds` | refunds | 912 | merchantId |
| `returns` | returnsTable | 825 | merchantId |
| `roles` | roles | 106 | merchantId |
| `shipping_settings` | shippingSettings | 1072 | merchantId |
| `stock_transfers` | stockTransfers | 1416 | merchantId |
| `store_settings` | storeSettings | 988 | merchantId |
| `suppliers` | suppliers | 1440 | merchantId |
| `tax_settings` | taxSettings | 1086 | merchantId |
| `theme_configs` | themeConfigs | 1881 | merchantId |
| `users` | users | 48 | merchantId |
| `visits` | visits | 1102 | merchantId |
| `warehouseInventory` | warehouseInventory | 1396 | merchantId |
| `warehouses` | warehouses | 1377 | merchantId |
| `webhook_deliveries` | webhookDeliveries | 1200 | merchantId |
| `webhook_endpoints` | webhookEndpoints | 1182 | merchantId |

**Outlet (11)**

| Table | Schema var | Line | Scope keys |
|---|---|---|---|
| `delivery_orders` | deliveryOrders | 772 | merchantId, outletId |
| `delivery_zones` | deliveryZones | 705 | merchantId, outletId |
| `kitchen_stations` | kitchenStations | 614 | merchantId, outletId |
| `kitchen_tickets` | kitchenTickets | 637 | merchantId, outletId |
| `menu_item_outlets` | menuItemOutlets | 232 | merchantId, outletId |
| `order_items` (via orders+products+product_variants) | orderItems | 481 | - |
| `orders` | orders | 414 | merchantId, outletId, customerId |
| `table_sections` | tableSections | 535 | merchantId, outletId |
| `table_sessions` | tableSessions | 585 | merchantId, outletId |
| `tables` | tables | 556 | merchantId, outletId |
| `user_outlets` | userOutlets | 124 | outletId, userId |

**User (2)**

| Table | Schema var | Line | Scope keys |
|---|---|---|---|
| `drivers` | drivers | 729 | merchantId, userId |
| `token_blacklist` | tokenBlacklist | 1165 | userId |

**Customer (10)**

| Table | Schema var | Line | Scope keys |
|---|---|---|---|
| `carts` | carts | 1315 | merchantId, customerId |
| `customer_addresses` | customerAddresses | 1283 | merchantId, customerId |
| `customer_tags` | customerTags | 1952 | merchantId, customerId |
| `loyalty_accounts` | loyaltyAccounts | 1665 | merchantId, customerId |
| `loyalty_ledger` | loyaltyLedger | 1682 | merchantId, customerId |
| `passwordResetTokens` | passwordResetTokens | 1835 | merchantId, customerId |
| `referrals` | referrals | 1770 | merchantId, customerId |
| `reviews` | reviews | 845 | merchantId, customerId |
| `verificationTokens` | verificationTokens | 1851 | merchantId, customerId |
| `wishlist_items` | wishlistItems | 893 | merchantId, customerId |

_Total: 86 tables_

## Working-tree verification (SaaS audit, September 11, 2026)

Claims from the audit report were checked against `apps/api/src` and
`apps/storefront/src`:

### Verified correct already
- **Storefront isolation** — `StorefrontService.resolveStore` only resolves
  `status = 'active'` merchants (`modules/storefront/service.ts:218`). Cancelled /
  suspended stores are not publicly served, and all public fetches derive the
  merchant from that single verified lookup.
- **Storage isolation** — object keys are merchant-partitioned
  `{merchantId}/{cuid}.{ext}` (`shared/storage.ts:71,109`). The public
  `/uploads/*` route serves only allowlisted image content types with
  magic-byte-sniffed content (never the client-declared type) and
  `nosniff` (`modules/uploads/index.ts`).
- **Refresh cannot resurrect a suspended store** — the auth `derive` re-reads the
  DB on every request and rejects users/merchants not in the active set
  (`plugins/auth.ts:156,162`). A token issued before suspension is rejected on the
  next request (covered by `test/merchant-lifecycle.test.ts`).
- **Frontend state isolation** — storefront cart / account keys are
  slug-scoped (`ecom:cart:{slug}`, `ecom:cartid:{slug}` — `cart.svelte.ts:17-18`),
  so a shopper's cart cannot bleed across storefronts.
- **Authorization vocabulary** — `OutletScope`, `assertInOutletScope()`,
  `resolveEffectiveScope()`, and `branchScopeIds()` are enforced in the outlet /
  restaurant modules (`shared/outlet-scope.ts`), with dedicated isolation tests.

### Confirmed gaps, now fixed
- **Merchant lifecycle was all-or-nothing** — `merchants.status` was an untyped
  varchar defaulting to `'active'`, gated by a hard-coded `status === 'active'`
  compare in three places. No `pending / trialing / past_due / suspended /
  cancelled / archived` model existed in code (only in docs).
  - Fixed: `shared/merchant-lifecycle.ts` — canonical status type, transition
    table with triggers + required effects, `assertTransition()`, and
    `isOperational()` / `isPubliclyServable()` helpers.
  - Enforcement now routes through the lifecycle module: `plugins/auth.ts`,
    `modules/auth/service.ts` (login + session), `modules/storefront/service.ts`.
    `OPERATE_STATUSES` = active/trialing/past_due (past-due merchants keep their
    grace period; suspended/cancelled/archived/pending are hard-blocked).
  - `merchants.status` is `$type<MerchantStatus>()` in `database/schema.ts:41`;
    login/session responses now expose `merchant.status`
    (`modules/auth/model.ts` `authMerchant`).
  - 11 new tests in `test/merchant-lifecycle.test.ts` cover the model,
    suspended-login rejection, pre-suspension-token rejection, past-due
    continued access, and storefront hiding of cancelled stores.

### Confirmed gaps, tracked (not part of this change)
- **Entitlements are boolean module flags only** — `resolveMerchantContext`
  reads `merchant_modules.enabled`; there is no plan-derived entitlement, quota,
  or override model (`shared/merchant-context.ts:43-74`). The audit's entity set
  (`plans`, `plan_entitlements`, `merchant_subscriptions`, usage counters, …)
  does not exist yet.
- **SaaS billing** — no billing customers/subscriptions/invoices; the only
  billing-adjacent entities are commerce payments and `webhook_events`.
- **Platform administration** — no platform-admin principal; merchant RBAC is the
  only authorization surface.
- **RLS** — application-enforced tenant predicates exist but PostgreSQL
  Row-Level Security is not configured.
- **Tenant-level quotas / noisy-neighbor controls** — rate limiting exists
  (`rate-limit.ts`) but is not tenant-quota-aware beyond that.

Regenerate this inventory any time with:

```bash
cd apps/api && bun scripts/tenant-scope-inventory.ts      # console
cd apps/api && bun scripts/tenant-scope-inventory.ts --md # markdown
```