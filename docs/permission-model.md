# JamiCore Permission Model

## How authorization is enforced today

Two composable guards exist in `apps/api/src/plugins/`:

- `authPlugin` (`plugins/auth.ts`) — validates the JWT, attaches `auth`
  (user, merchant, role, permissions), and provides `hasPermission` /
  `requirePermission`.
- `outletGuard` (`plugins/outlet.ts`) — composable guard that enforces, in
  order: (1) authentication, (2) module enabled for the merchant, (3) outlet
  scope if `outletRequired`, (4) permission. It resolves a validated
  `merchantContext` (merchant + enabled modules + selected outlet) and never
  trusts `body.outletId` / `x-outlet-id`.

## Authoritative permission source

Runtime checks read **`users.role`** (owner/admin bit) + **`users.permissions`**
(JSON array of permission strings) **+ `users.role_id`** → the merchant's
`roles` row. A user's *effective* permission set is the union of:

- the permissions of the role referenced by `users.roleId` (null when no role
  is assigned), and
- the legacy `users.permissions` array (kept as a backward-compatible per-user
  overlay for rows granted before roles became authoritative).

`hasPermission` allows:
- `owner` role to do anything,
- `admin` role to do anything,
- otherwise any of the requested permissions present among the user's effective
  permissions.

The effective set is derived by expanding each grant through `PERMISSION_ALIASES`
(see below) — so legacy colon-form grants kept in existing rows still authorize
the dotted guards they map to. New grants (staff create/update, role
create/update, seed) are stored already-normalized, dotted-only. Editing a role
row immediately changes the effective permissions of every user assigned to it
(the role is re-read on every authenticated request); no token reissue is
needed. `roles.scope` (GLOBAL/MERCHANT/OUTLET/OWN) is stored on each role and
declares the intended blast radius, but outlet resolution still uses
`user_outlets` today — role-driven scope enforcement is a listed evolution.

The permission vocabulary lives in `apps/api/src/shared/types.ts` (`PERMISIONS`,
`MODULES`, `DEFAULT_ROLES`), and `roles` rows are seeded per merchant from
`DEFAULT_ROLES` (owner/admin/staff accounts link to their system roles; staff
seeds keep explicit grants via `roleId = null`). The `roles` table is now part
of the enforcement path via `users.roleId`; the legacy `users.role` text remains
for the owner/admin bypass bit and backward compatibility.

## Permission groups (namespaced)

- `commerce.write` / `commerce.manage`
- `products.write` / `products.manage`
- `orders.write` / `orders.manage`
- `inventory.write` / `inventory.manage`
- `customers.write` / `customers.manage`
- `settings.write` / `settings.manage`
- `menu.read|manage`, `food_orders.read|manage`, `tables.read|manage`,
  `kitchen.read|manage`, `delivery.read|manage`, `reviews.manage`,
  `roles.manage`, `outlets.manage`, `modules.manage`, `marketing.manage`,
  `analytics.read`, `finance.read` … (see `shared/types.ts`)

## Permission string convergence (P2-2, done)

All `requirePermission(...)` guards now use the dotted vocabulary only; the
legacy colon-form strings are gone from guards and from seed/staff grants. The
legacy values remain in the `Permission` union and `PERMISSIONS` list purely so
already-stored rows keep type-checking, and are normalized to their dotted
equivalents by `PERMISSION_ALIASES` in `shared/types.ts` both when new grants
are stored (`normalizePermissions` in the staff service) and when
`hasPermission` evaluates a user's effective permissions (`resolvePermissions`).

| Legacy | Dotted equivalents |
|---|---|
| `products:write` | `products.create`, `products.update`, `products.delete` |
| `orders:write` | `orders.create`, `orders.update`, `orders.cancel` |
| `inventory:write` | `inventory.adjust`, `inventory.manage` |
| `discounts:write` | `settings.manage` (discounts = store-level commerce settings) |
| `settings:write` | `settings.manage` |
| `analytics:read` | `reports.read` |

The targets were chosen to preserve the effective capabilities each legacy
grant produced before the convergence. `API_KEY_SCOPES` keeps its own colon
vocabulary (machine/partner scopes, unrelated to staff grants).

## Module enablement

- `merchant_modules` gates modules: `commerce`, `restaurant`, `pos`,
  `kitchen`, `tables`, `delivery`, `inventory`, `marketing`, `analytics`.
- `outletGuard` returns 403 when the module is disabled. Merchants without a
  row fall back to `commerce` only.

## Rules

1. Frontend hiding is **not** authorization — every guard is server-side.
2. `owner` is immutable and cannot be removed/deleted via staff APIs.
3. Outlet scope is resolved server-side and validated against the user's
   `user_outlets` assignments (owners/admins default to all).
4. Client-supplied `outletId` is never trusted.
5. Staff `role` is constrained to `admin|staff` on create and
   `owner|admin|staff` on update.