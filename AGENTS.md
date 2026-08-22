# AGENTS.md — Project Memory

> Audit date: 2026-08-22 · HEAD: `e1630b6` + security/bug-fix batch (uncommitted)
> Verified state after fix batch: tests 38/38 pass · typecheck pass · svelte-check 0 errors (web has ~70 pre-existing a11y warnings)

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
bun run test               # bun test (api only — 3 files: smoke, storefront, checkout)
bun run typecheck          # tsc --noEmit (api only)
bun run check              # svelte-check (web + storefront)
bun run db:migrate && bun run db:seed   # seed idempotent
docker compose up -d       # postgres:18-alpine :5432 (needs sudo on this machine)
```

Seed admin login: `admin@acme.com` / `password123` (merchant slug `acme-store`).
Env: copy `.env.example` → `.env` (root) **and** `apps/api/.env`. Secrets are JWT_ACCESS_SECRET/JWT_REFRESH_SECRET/DATABASE_URL/PORT; turbo `globalEnv` tracks these for cache keys.
CI (`.github/workflows/ci.yml`): bun 1.3.14 + node 22, postgres:16 service → install --frozen-lockfile → typecheck → check → migrate+seed+test → build.

## API architecture (apps/api)

- Bootstrap chain in `src/app.ts`: onError → cors(origin /.*) → swagger(/docs) → 10 modules.
- Module convention: `modules/<feature>/{index.ts (controller/routes), service.ts (business logic class, returns status(4xx)), model.ts (TypeBox schemas)}`. Modules: auth, overview, products(+categories/variants/bulk), orders(+returns/refunds), inventory, customers, discounts, analytics, settings, storefront(public).
- Plugins: `errors.ts` (global error → `{success:false,error:{code,message}}`), `auth.ts`. NOTE: README mentions `plugins/db.ts` but it doesn't exist — services import `{ db }` directly from `database/client.ts`.
- Response envelope: `{ success, data }` / `{ success, error }`; paginated adds `meta {page,limit,total,totalPages}` (`shared/pagination.ts`).

### Auth
- JWT access (1h) + refresh (7d) via @elysiajs/jwt; bcryptjs hashes; refresh rotation with `token_blacklist` table (sha256-hashed jti via `Bun.CryptoHasher`, opportunistic prune).
- **Refresh token lives in an httpOnly cookie** (`md.refresh`, path `/api/auth`, sameSite lax, secure in prod). Body still carries it for non-browser API clients/tests. Cookie is set on login/refresh and expired via `.set(expireRefreshCookie)` on logout — do NOT use `.remove()`, it emits `Path=/` which doesn't match.
- `authPlugin` derive guard: verify token → check blacklist → load active user + active merchant → context `{ auth: { user, merchant } }`. All routes scoped by `merchantId` from JWT (multi-tenant isolation).
- Roles: owner > admin > staff. `isAdmin()` = owner/admin; staff writes gated by `permissions[]` jsonb. Settings/staff routes need admin.
- CORS (`app.ts`): `CORS_ORIGINS` env (comma-separated) or defaults to localhost:5478/5479 only. In turbo globalEnv.

### DB (src/database/schema.ts)
19 tables, all merchant-scoped except merchants/settings/token_blacklist: merchants, users, categories(self-FK tree), products, product_variants(jsonb option_values), inventory_logs(before/after), customers, orders(order_number unique per merchant), order_items, returns, refunds, coupons(unique per merchant code), promotions, store/payment/shipping/tax settings (1 row per merchant, PK=merchant_id), visits(daily per channel), token_blacklist.
Conventions: ids varchar(30) cuid2; money = numeric(12,2) mode:'number'; soft-delete = products.status 'archived' (DELETE /products/:id archives); updatedAt via `$onUpdate`.
Migrations committed in `drizzle/` (0000–0002). Analytics computed live via SQL aggregation (no denormalized tables).

### Storefront public API (no auth)
`/api/store/:slug/*`: GET store, categories(tree+counts), products(filters/sort price_asc|price_desc|newest), products/:productSlug(+variants+related), search; POST checkout/preview (validates stock/variants/coupon, computes subtotal/shipping/tax/total), POST checkout (creates order, decrements inventory + logs, upserts customer); GET orders/:orderNumber (public confirmation).

## Web dashboard (apps/web)
Routes under `(app)/`: dashboard, analytics(tabs+range), products(list+[id] variants, CreateEditProduct modal, CategoriesManager), inventory(all/low/out/history), orders(list+[id] returns/refunds), customers(list+[id]), discounts(coupons/promotions tabs), settings(store/payments/shipping/taxes/staff). Plus `/login`, `/` redirector.
State: `session.svelte.ts` (Svelte 5 runes singleton; bootstrap() hydrates from /auth/me; login() now also fetches settings via fetchMe; isAdmin, can(perm)); **access token only** in localStorage (`md.access`) — refresh is cookie-based; api.ts single-flight refresh (`refreshPromise ??=`) so concurrent 401s share one refresh call. UI components: Badge, Button, Card, Modal, Pagination, Toast (+toast.svelte.ts store).
`hooks.server.ts`: server-side guard — protected prefixes (dashboard/analytics/products/inventory/orders/customers/discounts/settings) require `md.refresh` cookie else 302 /login; /login redirects to /dashboard when session present. Presence check only (not JWT verification) — real auth still enforced by API.

## Storefront (apps/storefront)
Routes under `[slug]/`: home(featured 8), products(list w/ filter form), products/[product](variant picker PDP), categories/[category], search(?q=), cart(client-side), checkout(contact/address/coupon → preview → place order), orders/[orderNumber](confirmation).
Cart: `cart.svelte.ts` class singleton, localStorage key `ecom:cart:${slug}`, lines snapshot product data at add-time, merge by variantId, qty cap 99. api.ts uses injected fetchFn (SSR-safe), typed ApiError, plus `loadError(err, notFoundMessage)` helper — all page.server loads wrap API calls; ApiError 404 → SvelteKit error(404), else error(status)/rethrow. Home degrades gracefully to empty featured list. PDP resets variant/qty/notice via `$effect` keyed on `data.product.id`; selectedVariant falls back to variants[0] when stale.

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
- Roadmap-next items: storefront auth/customer accounts, Stripe, wishlists, reviews

## Gotchas
- Elysia: method chaining required for type inference; explicit `.use()` for plugins that add context types
- drizzle-typebox: pre-declare schema vars before t.Omit/t.Pick (infinite type instantiation otherwise)
- Elysia Cookie: `.remove()` ignores custom path (emits Path=/) — expire cookies via `.set({ value:'', maxAge:0, expires:new Date(0), path })` instead. Cookie.set() merges over `initial`, not previous set() calls.
- Docker on this machine needs `sudo docker`
- Bun installed at `~/.bun/bin` (add to PATH if missing)
- pkill -f self-matches the bash command string — kill by exact PID from `ps -eo pid,args | grep ... | grep -v grep` instead
