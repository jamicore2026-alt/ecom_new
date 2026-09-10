# JamiCore — Gap Analysis (Multi-Tenant SaaS)

Status: baseline audit · Date: 2026-09-10 · Evidence: source + test suite (284 pass) + graphify graph (2828 nodes)

This is the executive summary. Each dimension has its own deep-dive:

| Doc | Covers |
|-----|--------|
| `docs/gap-analysis-saas.md` | Multi-tenant platform mechanics: onboarding, plans/quota, billing, tenant lifecycle, platform admin, SSO, export, rate-limit, plan-driven gating |
| `docs/gap-analysis-design-system.md` | Token architecture (primitive → semantic → component), dashboard vs storefront consistency, presentation/slide system |
| `docs/gap-analysis-market.md` | Positioning vs Shopify/BigCommerce/Square 2026, the native F&B + warehouse wedge, market must-haves |

## Current state (what exists)

Row-level tenancy over a shared Postgres schema (`merchants` = tenant, `schema.ts:33`). Two-level tenancy merchant → `outlets` with strict server-side scope resolution (`shared/merchant-context.ts:31`); "every request merchant-scoped" invariant (`docs/business-invariants.md:68`). Per-tenant feature gating exists as a Boolean registry (`merchant_modules`, `schema.ts:89`). RBAC with authoritative roles table, audit logging, outbound webhooks, API keys, background jobs, endpoint-level rate limiting, and a broad commerce/F&B/warehouse feature set (41 dashboard routes).

## The gap, in one paragraph

JamiCore has the **commerce engine** of a multi-tenant SaaS but not the **subscription machine**. There is no way for a merchant to sign themselves up, no plan or price tier exists anywhere in the schema, nothing bills or duns, nothing enforces usage limits, and there is no platform-side back office to run the SaaS. Feature gating (`merchant_modules`) is a manual on/off switch per merchant — the natural upgrade target for plan-driven entitlement. Simultaneously, the surface is split: the dashboard runs a proper Material-3 semantic token layer while the storefront runs its own indigo/gray scale, so the two halves of the product don't feel like one brand.

## Roadmap (combined)

### P0 — becomes a sellable SaaS (blocks launch)
1. **Merchant self-serve signup + onboarding wizard** — tenant provisioning + first-store setup (name/slug/outlet/currency/timezone) — `gap-analysis-saas.md §P0-1`.
2. **Plans & entitlements** — `merchant_plans`, `plan_features`, `merchant.planId`, plan-derived module gating replacing the manual `merchant_modules` toggle with an audit-preserving override layer — `gap-analysis-saas.md §P0-2`.
3. **Billing/subscription engine** — Stripe/Paddle-style subscriptions, trials, dunning, service invoices (distinct from order `invoices`) — `gap-analysis-saas.md §P0-3`.
4. **Merchant lifecycle workflow** — trial/active/past_due/suspended/canceled state machine wired to billing webhooks + login gating — `gap-analysis-saas.md §P0-4`.
5. **Platform admin back office** — superadmin role + tenant list/approve/suspend/impersonate/support tooling — `gap-analysis-saas.md §P0-5`.

### P1 — production-ready multi-tenant resilience
6. Tenant-scoped usage quotas + enforcement (catalog/product/order/seat/GB) when plan limits are exceeded (`rate-limit.ts` is endpoint-rate, not usage-quota — extend).
7. Plan-driven feature gating surfaced in the dashboard's `/modules` route (read-only for non-owner).
8. Tenant data export (GDPR/DPA) — full tenant dump endpoint + deletion workflow.
9. Tenant-aware request budget & DB connection accounting (noisy-neighbor protection).

### P2 — platform-grade differentiators
10. SSO (OIDC/SAML + dashboard MFA/TOTP).
11. White-label / plan-tier theming (theme_configs is storefront-only today; extend to platform-level branding).
12. Multi-currency conversion and deeper i18n (ar/en exist; currency is per-merchant single-currency).
13. Public API externalization polish (api-keys exist; add rate tiers, webhooks productization, developer docs).
14. Design system unification (dashboard+storefront single token set, primitive layer, component tokens) — `gap-analysis-design-system.md`.

## Quick wins (small, high-value)
- Swap `theme/+page.svelte` and `dashboard/+page.svelte` raw hexes to tokens (`#004ac6` → `var(--color-primary)` etc.) — 8 sites.
- Port the storefront palette onto the M3 semantic token set (delete the parallel indigo/gray scale).
- Add a plan-quota stub column (`merchant.plan_id`) now so P0 migrations are additive, not destructive.
- Route the dashboard `/modules` page off `enabledModules` from `resolveMerchantContext` (already server-authoritative) rather than client-side lists.