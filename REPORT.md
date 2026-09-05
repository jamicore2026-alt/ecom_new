# Complete E2E UI/UX Audit — merchant-dashboard (ecom_new)

Date: 2026-09-05 · Stack (fresh production builds of HEAD 17fb032): web :5478, storefront :5479, API :3005
Method: Playwright 1.62.1 · 3 breakpoints (375 / 768 / 1440) · full-page screenshots for 44 dashboard routes + 10 storefront pages · console + network capture · overflow/scrollWidth detection with element attribution · E2E checkout against a live DB (Postgres 18, seeded).

## Result summary
- **No blockers** 🔴 · **4 grouped issues → 3 FIXED + verified** ✅ (segment pills, detail-page grids, stepper touch targets) · **1 investigated / no action** (transient hydration flicker) 🟡
- All flows verified ✅ (login incl. bad-creds validation, all routes render, mobile drawer, add-to-cart → checkout → COD order → confirmation, order cross-checked in dashboard)
- First-pass findings that were **false alarms** (verified clean): wide tables flagged at `right=821` are inside `overflow-x-auto` (correctly scrollable, no page overflow); 404s reported on `/products/{global-id}`,`/categories/…`,`/orders/…` were the audit using dashboard IDs/slugs instead of storefront slugs; `401` console entry is the intentional bad-login attempt.
- Remaining audit-system caveat: a ~9px `scrollWidth=384` overhang appears on some dashboard pages for ~1-2s at first paint, then settles to 375 (see #3).

## Verified flows ✅
| Flow | Result |
|---|---|
| Login bad creds → validation message | Pass |
| Login admin@acme.com → /dashboard | Pass |
| All 41 dashboard routes render (200, no error states) | Pass |
| Dashboard at 375/768/1440 — 33/41 routes have zero overflow | Pass |
| Mobile sidebar drawer opens/closes; all 10 items incl. Settings reachable, no clipping | Pass |
| Storefront home / products / product / search / category / cart / wishlist / account / forgot / order — clean at all 3 breakpoints | Pass |
| Add-to-cart → cart filled → checkout (fill + method auto-selected) → Place order → confirmation | Pass (`#WMTNWHCZQ4CF00F4E`) |
| Placed order cross-checked in dashboard API (`pending`, total 80.99) | Pass |
| Heading hierarchy (h1→h2, no skips) on 15 sampled pages | Pass |
| Console/network: no JS errors, no failed requests, no broken images anywhere | Pass |

## Findings

### 🟠 1. Segment/tab pill rows overflow the viewport on mobile — `/api-keys`, `/analytics` — **FIXED** ✅
A `flex w-fit` tab strip was wider than 375px: `/api-keys` 385px (10px), `/analytics` 380px (5px) — persistent page-level horizontal scroll on mobile. Applied the `max-w-full overflow-x-auto` guard (already used on `settings`/`reviews`) to all six occurrences: `api-keys:183`, `analytics:84`, `discounts:293`, `campaigns:99`, `transfers:141`, `inventory:115`. Re-verified at 375: `/api-keys`, `/analytics`, plus the four dormant pages have zero page overflow; pills remain clickable (tab switching verified).

### 🟠 2. Mobile overflow on detail pages — `/orders/[id]`, `/products/[id]` — **FIXED** ✅
Grid columns overran the 343px content column because grid items have `min-width:auto`: `/orders/[id]` → 405px (30px over), `/products/[id]` → 433px (58px over). Added `min-w-0` to the grid children in `orders/[id]/+page.svelte` (Items column + Summary sidebar) and `products/[id]/+page.svelte` (both columns), and wrapped the order-detail Items/Returns/Refunds tables in `overflow-x-auto` (matching the list pages). Re-verified at 375: both detail pages now 375px, zero overflow.

### 🟡 3. ~9px horizontal flicker while a few dashboard pages hydrate (transient) — **investigated, no action**
On cold loads (pos, kitchen, kds, delivery, inventory, orders list) a `material-symbols-outlined` span paints at right=384 for ~1-2s then settles to 375 (no persistent overflow, CLS-grade). Focused cold-context probes with 250ms sampling over 3s could not reproduce it, and static analysis of the drawer/header (drawer is `w-sidebar-width` 240px, header clusters are min-w-0/truncate) found no element that is 384px wide. Attributed to render-timing under the full-sweep CPU load; no speculative change made. Re-check if it shows up in real device usage.

### 🟡 4. Storefront numeric steppers below the 44px touch-target guideline — **FIXED** ✅
Qty − / + buttons measured 33 × 40 px. Added `min-w-11 min-h-11` in `storefront/…/products/[product]/+page.svelte:325,334` and `cart/+page.svelte:62,71`. Re-verified: buttons now 44 × 44 on both product and cart pages at 375, no overflow introduced.

## Reproduction & environment notes
- Run: `cd /tmp/opencode/e2e && node audit.js` (dashboard sweep), `node sf-audit.js` (storefront sweep), `node checkout-flow.js` (E2E).
- Stack: local Postgres (`ecom_merchant_db` on :5432), API `bun src/index.ts` on :3005, `adapter-node` builds on :5478/:5479, all sourced from root `.env`.
- No font workaround needed this time (system DejaVu present); Playwright 1.62.1 ↔ cached chromium build 1234.
- Screenshots: `/tmp/opencode/e2e/shots/` (full page per route × breakpoint); structured data `report.json`, `sf-report.json`.

### Prior audit (2026-08-30) — status
All 7 previous findings (products 375 overflow, tap targets, heading skips, login hydration race, rate-limit UX, sidebar clipping, empty merchant_modules) are still resolved in this build; no regressions observed. The live-site "sign out icon ~36-40px" note is now a 44px `h-11 w-11` target in the drawer aside.