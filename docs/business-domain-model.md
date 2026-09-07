# JamiCore Business Domain Model

JamiCore is a connected business operating platform: one merchant, one
transactional core, multiple sales channels (admin, POS, food orders, QR
ordering, storefront).

## Architecture

- `apps/api` — ElysiaJS + Drizzle + PostgreSQL. Single source of business logic.
- `apps/web` — SvelteKit merchant dashboard (admin console).
- `apps/storefront` — public storefront, per-merchant slug.
- `packages/api-proxy` — shared API client used by the frontends.

Every business operation crosses: UI → API → service → database →
validation → authorization → audit → downstream effects → tests.

## Module map

| Module | Domain |
|---|---|
| auth / customer-auth | Staff + shopper authentication, sessions, password reset |
| merchants (via seed) / settings | Business identity, store settings |
| outlets / user-outlets / roles / modules | Organization, tenancy, feature enablement |
| products / menu | Catalog (ecommerce) and restaurant menu, modifiers |
| inventory / warehouses / transfers | Stock, warehouses, transfers (no procurement yet) |
| carts / orders / food-orders / fulfillments / invoices | Commerce core |
| payments (myfatoorah, tamara, cod) | Payment adapters + transactions |
| customers / customer-tags / segments / reviews / loyalty | Customer 360 + retention |
| discounts / campaigns / affiliates | Promotions + marketing |
| tables / kitchen / delivery | Restaurant + delivery operations |
| analytics / profit / overview | Reporting + finance-lite |
| webhooks / outbound-webhooks / api-keys / audit-logs | Platform + developer surface |
| content / theme / storefront | Storefront content + branding |
| emails / background-jobs | Notification plumbing |

## Domain table (truth: `apps/api/src/database/schema.ts`)

Merchants, users, outlets, roles, user_outlets, merchant_modules,
menu_items, modifier_groups, modifiers, menu_item_modifiers,
menu_item_outlets, categories, products, product_variants, product_images,
inventory_logs, customers, customer_addresses, orders, order_items,
food_order_items, table_sections, tables, table_sessions, kitchen_stations,
kitchen_tickets, kitchen_ticket_items, delivery_zones, drivers,
driver_locations, delivery_orders, driver_assignments, returns, refunds,
reviews, wishlist_items, coupons, promotions, store_settings,
payment_settings, payment_provider_configs, payment_transactions,
webhook_events, shipping_settings, tax_settings, visits,
notification_settings, email_logs, token_blacklist, webhook_endpoints,
webhook_deliveries, background_jobs, fulfillments, carts, invoices,
warehouses, warehouse_inventory, stock_transfers, customer_segments,
loyalty_accounts, loyalty_ledger, loyalty_tiers, loyalty_earning_rules,
loyalty_rewards, affiliates, referrals, content_pages, api_keys,
password_reset_tokens, verification_tokens, checkout_settings,
theme_configs, cod_rules, carriers, campaigns, customer_tags.

## Cross-domain business flows

- **FLOW A — Online sale**: Customer → cart → checkout → order → payment
  (paid effects) → inventory decrement → fulfillment → invoice → customer
  history → analytics.
- **FLOW B — POS sale**: Staff → POS → food order (orderType POS) → payment
  → receipt.
- **FLOW C — Restaurant sale**: Table/QR → menu → food order → KOT → kitchen
  → ready → payment → completion.
- **FLOW D — Purchase** *(planned, not implemented)*: Supplier → PO →
  approval → goods receipt → inventory.
- **FLOW E — Stock transfer**: Warehouse A → transfer → in transit →
  warehouse B → receive.
- **FLOW F — Return**: Order → return request → approval → restock →
  refund → idempotent payment reversal.
- **FLOW G — Production / BOM** *(planned)*: BOM → production order →
  component consumption → finished goods.
- **FLOW H — Recipe** *(planned)*: recipe → ingredient consumption →
  inventory decrease → menu sale.

## Status conventions

Orders use combined `status` (order lifecycle) + `paymentStatus` +
`fulfillmentStatus`. Food orders reuse `orders.status`. Inventory changes are
recorded in `inventory_logs` with `reason` (`sale`, `adjustment`, `import`,
`cancel`, `return`, `count`, `transfer`). See `docs/business-invariants.md`.