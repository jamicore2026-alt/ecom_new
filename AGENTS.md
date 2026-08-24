# AGENTS.md — Project Memory

> Audit date: 2026-08-24 · HEAD: `b6f239a` (Phase 1 committed) + Phase-2 complete: customer accounts + reviews + wishlists + FTS search + CSV export/import (all uncommitted)
> Verified state after CSV batch: tests 96/96 pass (12 files, new csv.test.ts) · typecheck pass · svelte-check 0 errors (web has 71 pre-existing a11y warnings)
> NOTE: seed now clamps order qty to stock and ×4s variant inventory — re-run `bun run db:seed` to restore; tests find products with stock ≥ 20

## What this is

Multi-tenant e-commerce monorepo (**Turborepo + Bun**, packageManager `bun@1.3.14`). Three apps, no packages/ yet.

| App | Stack | Port | Notes |
|---|---|---|---|
| `apps/api` | ElysiaJS + Drizzle ORM + PostgreSQL | 3005 | Swagger at `/docs`. TypeBox validation via drizzle-typebox |
| `apps/web` | SvelteKit 2 + Svelte 5 (runes) + Tailwind v4 | 5478 | Merchant dashboard. Client-rendered (`onMount` fetches, no load fns) |
| `apps/storefront` | SvelteKit 2 + Svelte 5 + Tailwind v4 | 5479 | Public storefront, SSR load functions, multi-store via `/[slug]` |

Both SvelteKit apps proxy `/api → http://localhost:3005` in dev (`vite.config.ts`, strictPort). Storefront home `/` redirects to `/{PUBLIC_DEFAULT_STORE}` = `acme-store`.

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

## Web dashboard (apps/web)
Routes under `(app)/`: dashboard, analytics(tabs+range), products(list+[id] variants, CreateEditProduct modal, CategoriesManager), inventory(all/low/out/history), orders(list+[id] returns/refunds), customers(list+[id]), discounts(coupons/promotions tabs), settings(store/payments/shipping/taxes/staff). Plus `/login`, `/` redirector.
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
