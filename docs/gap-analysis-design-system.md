# Gap Analysis — Design System & Tokens (Dimension 2)

Scope: token architecture (primitive → semantic → component), dashboard vs storefront consistency, brand documentation, and the slide/presentation layer. Ratings: **GAP (missing) / PARTIAL (exists, wrong layer) / OK**.

## Current token state (audited)

### Dashboard — `apps/web/src/app.css` (263 lines) — **PARTIAL**
Solid **semantic layer**: Material-3 tokens for light **and** dark (`[data-theme='dark']` at `app.css:135`), plus:
- `--color-*` family: primary/secondary/tertiary/error, full surface-container ramp (lowest→highest), outline/variant, inverse, success/danger/warning/info — `app.css:7-64`.
- Radius scale (`app.css:66-71`), spacing scale incl. sidebar/container/cell metrics (`app.css:73-79`), font family set (`app.css:81-87`), text scale (body/table-headline/display/mono with weight/line-height) (`app.css:89-109`).
- Thin component layer: 4 field classes in `@layer components` (`app.css:198-251`), focus-visible, touch-target media query (`app.css:256-262`).

**Gaps in the dashboard:**
1. **No primitive tier.** Tokens are raw hex *as* semantic tokens (`--color-primary: #004ac6`). Rebranding = editing the alias, and function colors (success/danger/info) are welded into the brand palette instead of being mapped roles.
2. **Component tier ~absent.** Only `.field*`; everything else (Button, Card, Badge, Icon in `apps/web/src/lib/components/`) consumes semantic utilities directly. No `--button-bg`-style tokens → per-component theming/customization impossible without code edits.
3. **Hardcoded hexes outside tokens** (8 sites, all legit but untokenized):
   - `apps/web/src/routes/(app)/theme/+page.svelte:10-12` — **diverges from the app palette** (`#4f46e5`/`#6b7280`/`#f59e0b` vs `--color-primary: #004ac6`). Also a raw color-input (`:176`).
   - `apps/web/src/routes/(app)/dashboard/+page.svelte:139,140,157,163` — sparkline gradient/stroke hardcode `#004ac6` instead of `var(--color-primary)`.
4. **No documented scales.** Radius/spacing/text scales exist but are undocumented (no figma/spec, no `docs/brand-guidelines.md`), so no one can safely extend them.

### Storefront — `apps/storefront/src/app.css` (31 lines) — **GAP / split-brain**
Runs its **own** Tailwind indigo scale (`--color-brand-50…900`, `#eef2ff…#312e81`) + gray neutral scale (`--color-neutral-*`) (`app.css:9-30`) — **unrelated to the dashboard's M3 blue palette**. Consequences:
- Two different brand colors shipping today (indigo `#6366f1` vs blue `#004ac6`).
- No dark theme, no text scale, no radius/spacing tokens.
- 0 hardcoded hexes *outside* the token block (good hygiene), but the token block itself is the wrong, parallel source of truth.

### Theme switching
Dashboard has `theme.svelte.ts` + `[data-theme='dark']`; storefront has neither. Theme page lets merchants pick colors — but those picks don't feed `theme_configs` → storefront tokens in a structured way (colors are surfaced as raw CSS on the theme route, implying a JSON→CSS bridge is missing).

---

## Gap list

| # | Gap | Severity | Evidence |
|---|-----|----------|----------|
| D1 | No primitive tier (semantic values are raw hex) | High | `app.css:7-64` |
| D2 | No component-tier tokens (shared UI kit not tokenized) | High | `@layer components` only field classes, `app.css:198` |
| D3 | Storefront palette split-brain (indigo vs blue) | High | `storefront/src/app.css:9-30` vs `web/src/app.css:7` |
| D4 | No dark theme in storefront | Medium | storefront `app.css` 31 lines |
| D5 | Raw hexes outside tokens (theme page diverges from app colors) | Medium | `(app)/theme/+page.svelte:10-12`, `dashboard/+page.svelte:139-163` |
| D6 | No `docs/brand-guidelines.md`, token JSON, or generation/validation scripts | Medium | repo root has none of these |
| D7 | No slide/presentational system for the product | Low | design-system skill defines one; not present in repo |
| D8 | Theme page selected colors not wired into a token pipeline | Low | `theme/+page.svelte` writes raw values |

---

## Three-layer token migration plan

Target structure (mirrors the `design-system` skill):

```
tokens/design-tokens.json        # single source of truth (three layers)
→ scripts/generate-tokens.cjs    # JSON → CSS (also emits Tailwind v4 @theme block)
→ scripts/validate-tokens.cjs    # forbids raw hex/rgb outside token files
→ apps/web/src/app.css           # generated semantic tokens
→ apps/storefront/src/app.css    # generated (same source)
→ docs/brand-guidelines.md       # colors, type, spacing, logos
```

**Layer 1 — Primitive (raw):** the raw palette extracted to explicit primitives, e.g.

```css
--color-blue-600: #004ac6;   /* dashboard primary tube */
--color-indigo-500: #6366f1; /* storefront legacy brand */
--color-neutral-500: #6b7280;
--color-green-600: #047857;  --color-red-600: #d92d20;  --color-amber-600: #b45309;
/* …full ramp + neutral ramp + your F&B accent if any */
```

**Layer 2 — Semantic (mapped roles):** maintain the current M3 aliases but as `var()` indirection so a rebrand touches primitives only:

```css
--color-primary: var(--color-blue-600);
--color-success: var(--color-green-600);
--color-surface-container-lowest: var(--color-neutral-0);
```

Light (`:root`/`@theme`) and dark (`[data-theme='dark']`) become two **maps over the same primitives** — kills the duplicated value sets currently in `app.css:135-196`.

**Layer 3 — Component (per-component):** add a component tier for the shared kit (`apps/web/src/lib/components/`), e.g. `--button-bg/-hover/-text`, `--card-surface/-border`, `--field-bg/-border`, `.field` moves onto them. Enables per-component overrides and merchants' theme route later.

### Unification steps (storefront)
1. Delete `--color-brand-*`/`--color-neutral-*` from `storefront/src/app.css`; import the shared generated token file.
2. `brand-* → primary` map (or keep an explicit `storefront map` in tokens.json).
3. Add dark theme + text scale to storefront via the same generator.
4. Fix the 8 raw-hex sites in web (`theme`, `dashboard`) to `var()`; make the theme page color-picks emit semantic overrides, not bare hex.

---

## Deliverables on implementation

1. `tokens/design-tokens.json` + `scripts/generate-tokens.cjs` + `scripts/validate-tokens.cjs` (portable, matches `generate-tokens.cjs --config tokens.json` UX of the skill).
2. `docs/brand-guidelines.md` — palette (with the blue/indigo decision documented), type pairing (Geist + Cairo Variable noted at `app.css:81-87`), spacing scale, radius semantics, logo usage (the M-on-blue favicon at `apps/*/static/favicon.svg`).
3. Migration of `apps/web/src/app.css` → generated, dark via primitive mapping; port `apps/storefront/src/app.css` onto the same source.
4. Component tokens for the shared kit; theme route tokenized and fed by a JSON→CSS bridge.

**Out of scope / optional:** the slide-presentation system (Chart.js decks, `data/slide-*.csv`, search scripts) from the design-system skill — a product-internal capability with no current consumer; add only if investor/demo decks become a recurring need.

---

## Gap vs competitors (why it matters)

The dashboard already beats typical open-source admin theming (real M3 tone-ramp + dark mode). The failing is **consistency**: a merchant sees indigo on their storefront and blue in their dashboard — which reads as unbranded/whiteboxed, undermining the SaaS positioning (see `gap-analysis-market.md`). Closing D1–D3 is prerequisite to believable platform theming (SaaS P2 · white-label).