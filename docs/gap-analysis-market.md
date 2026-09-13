# Gap Analysis — Market & Positioning (Dimension 3)

Scope: JamiCore's feature surface vs the 2026 multi-tenant commerce SaaS landscape (Shopify, BigCommerce, Square), and where the sustainable wedge is. Market data: public 2026 pricing/feature comparisons (Sept 2026). Product data: route inventory + schema audit.

## What JamiCore ships today (inventory)

**Commerce core:** products w/ variants + categories, inventory + thresholds, stock movements, checkout w/ promotions/discounts/COD rules/checkout settings, orders (full state machine), payments (MyFatoorah, Tamara), coupons, invoices, refunds (idempotent retries), reviews, wishlist, carts, customer accounts + addresses + tags + segments.
**F&B native:** menu items → modifier groups → modifiers → per-outlet availability + price overrides (`schema.ts:142-241`), table sessions + POS, kitchen display (`/kds` stations/tickets/items), food orders, delivery fleet (zones, carriers, drivers, assignments).
**Warehouse/manufacturing native:** warehouses + stock transfers, procurement (suppliers, purchase orders, goods receipts), BOM/production orders (`schema.ts:1437-1630`).
**Operations completion:** fulfillments (carrier/tracking/label), idempotent checkout (orders/refunds idempotency keys), customer self-service auth (verify/reset/forgot), SEO (storefront sitemap.xml + robots.txt).
**Growth tooling:** affiliates/referrals, campaigns, loyalty (tiers/rewards/rules/ledger), email templates, content pages, theme configs, analytics/profit, CSV import/export, API keys, outbound webhooks, audit logs.
**Tenancy:** merchant tenants, outlets, RBAC roles, module gating (see `gap-analysis-saas.md`).

## Competitive frame (2026 baseline)

| Capability | Shopify | BigCommerce | JamiCore today |
|---|---|---|---|
| Plans / pricing | $29–$299/mo (+Plus ~$2,300) | $29–$399/mo, GMV tiers | **None** (see SaaS gaps) |
| Free trial / onboarding | 3-day trial + guided wizard | 15-day trial | **None** (seed-only tenants) |
| Native POS | Yes | No (3rd party) | **Yes** |
| Kitchen / KDS / tables / food ordering | No (apps) | No | **Yes — native** |
| Delivery fleet (zones/carriers/drivers) | No (apps) | No | **Yes — native** |
| Warehouse / transfers / procurement / BOM | Apps (Inventory apps) | Partial (multi-warehouse via apps) | **Yes — native** |
| App ecosystem | 8,000+ | ~1,300 | 0 (not a goal) |
| Multi-currency | ✓ (Markets, 140+) | ✓ (140+) | ✗ (single per-merchant) |
| Multi-language | via apps/Markets | via apps | ar/en baked in |
| Staff accounts | 2–15 by plan | unlimited | role-based (no seat limit) |
| B2B features | Plus-tier/apps | native | out of scope |
| Transaction fees | 0–2% | none | (payment providers already: MyFatoorah/Tamara) |

## The actual gap / opportunity

**JamiCore is not competing to be "Shopify for X".** Its differentiator — *the whole reason a merchant signs up* — is that **point-of-sale, dining/restaurant flow, delivery ops, and warehouse/manufacturing are native**, not app-shaped. On Shopify or BigCommerce every one of those is a paid app, a separate data model, and an integration project. That is the wedge: **"one box for merchants who sell across storefront + physical outlet + dine-in + delivery + inventory across warehouses."**

The F&B data model alone is a selling point against POS competitors: a full menu (items → modifier groups → modifiers), per-outlet availability and price overrides (`menu_item_outlets`), time-based item availability, kitchen-station routing, and KOT ticket state — all native, wired to the same orders/checkout/warehouse engine the storefront uses. Toast/Square do POS menus; they don't pair them with multi-warehouse inventory, procurement PO's, and a BOM-driven production floor in one subscription.

The market **gap** JamiCore must close to make that wedge sellable:

1. **Monetization plumbing (blocks everything):** plans, trial, billing, self-serve signup, lifecycle — see `gap-analysis-saas.md` P0. Competitors all have this; without it JamiCore can't even be tried.
2. **International depth (P2):** multi-currency conversion + broader i18n. In an SMB-GCC/EMEA context (Cairo/Arabic pairing, MyFatoorah) this is concrete: match at least a pricing/language story for the regions the payment integrations already serve.
3. **Coherent brand surface (P2):** the storefront-dashboard palette split (see design-system gaps D1–D3) undercuts platform trust.
4. **Platform white-label (P2):** competitors brand-lock; a plan-tier white-label on dashboard + storefront is a genuine differentiator for agencies/resellers — cheap to build given `theme_configs` exists.
5. **B2B:** explicitly **not** a gap to chase now — Shopify Plus/BigCommerce B2B is a deep, mature hill (net terms, PO checkout, buyer hierarchies).

## Recommended positioning

**Hero line:** *"Point-of-sale, storefront, dine-in, delivery, and warehouse in one multi-tenant platform."*

- **Primary segment:** small/mid-market omnichannel merchants who also run a counter/restaurant and a stockroom — the exact profile mainstream SaaS prices out with per-app subscriptions.
- **Proof wedge:** quickest lighthouse feature is the F&B + delivery + storefront combo (KDS, tables, food orders, drivers) — no mainstream competitor offers it natively at SMB price points.
- **Avoid:** generic "e-commerce platform" framing (drowns vs Shopify); pure restaurant POS (Toast/Square rule it). The overlap zone is the moat.

## Feature-parity must-haves vs nice-to-haves

**Must-have before launch** (P0, from `gap-analysis-saas.md`): signup/onboarding, plans, billing, lifecycle, platform admin. These are prerequisites to *any* positioning.
**Should-have within 6 mo:** seeded demo store, import merchant (migration tooling), quote-able docs/SLA.
**Stretch (12 mo):** apps/marketplace to open the platform; multi-currency; white-label.

## Risk note

Competitor majority risk table is light on purpose — the analysis deliberately focuses on what JamiCore *can* do natively versus app-gated features, so the recommendation degrades gracefully if "Shopify/BigCommerce" is replaced by regional SaaS (e.g. local MENA platforms): the native F&B/delivery/warehouse wedge holds regardless of which platform is the reference.