import type { ModuleId, Permission } from './types'

/**
 * Centralized navigation metadata.
 *
 * Frontend filters this to show the right shell for each role/module/outlet.
 * Server-side authorization remains mandatory on every API route — hiding a
 * nav item is UX only and never a security boundary.
 *
 * `module` gates the item behind the merchant having that module enabled.
 * `permission` (single or any-of array) further gates it per user.
 * Neither set → available to every authenticated user (e.g. Overview, Audit).
 */
export interface NavItem {
	label: string
	route: string
	/** i18n dictionary key for the label (fallback: `label`). */
	key?: string
	/** Material Symbols Outlined name, e.g. 'dashboard' */
	icon: string
	group: string
	/** Module that must be enabled for the merchant, or undefined for core. */
	module?: ModuleId
	/** Any-of permissions; owner/admin bypass via session.can(). */
	permission?: Permission | Permission[]
}

export const NAV_ITEMS: NavItem[] = [
	// General — daily operations
	{ label: 'Overview', key: 'nav.overview', route: '/dashboard', icon: 'dashboard', group: 'General' },
	{ label: 'Orders', key: 'nav.orders', route: '/orders', icon: 'receipt_long', group: 'General', module: 'commerce', permission: ['orders.read', 'orders:write'] },
	{ label: 'Customers', key: 'nav.customers', route: '/customers', icon: 'group', group: 'General', module: 'commerce', permission: 'customers.read' },
	{ label: 'Outlets', route: '/outlets', icon: 'storefront', group: 'General', permission: 'staff.read' },
	{ label: 'Abandoned Carts', route: '/cart-recovery', icon: 'shopping_cart', group: 'General', module: 'commerce', permission: 'customers.read' },
	// Catalog — products, stock and supply
	{ label: 'Products', key: 'nav.products', route: '/products', icon: 'inventory_2', group: 'Catalog', module: 'commerce', permission: ['products.read', 'products:write'] },
	{ label: 'Inventory', key: 'nav.inventory', route: '/inventory', icon: 'warehouse', group: 'Catalog', module: 'inventory', permission: ['inventory.read', 'inventory:write'] },
	{ label: 'Warehouses', key: 'nav.warehouses', route: '/warehouses', icon: 'warehouse', group: 'Catalog', module: 'inventory', permission: ['inventory.read', 'inventory:write'] },
	{ label: 'Transfers', key: 'nav.transfers', route: '/transfers', icon: 'swap_horiz', group: 'Catalog', module: 'inventory', permission: ['inventory.read', 'inventory:write'] },
	{ label: 'Stocktake', route: '/inventory/stocktake', icon: 'fact_check', group: 'Catalog', module: 'inventory', permission: ['inventory.read', 'inventory:write'] },
	{ label: 'Procurement', route: '/procurement', icon: 'local_shipping', group: 'Catalog', module: 'inventory', permission: ['inventory.read', 'inventory.manage'] },
	{ label: 'Production', route: '/production', icon: 'factory', group: 'Catalog', module: 'inventory', permission: ['inventory.read', 'inventory.manage'] },
	// Marketing — demand, loyalty and content
	{ label: 'Discounts', key: 'nav.discounts', route: '/discounts', icon: 'sell', group: 'Marketing', module: 'marketing', permission: 'discounts:write' },
	{ label: 'Campaigns', key: 'nav.campaigns', route: '/campaigns', icon: 'campaign', group: 'Marketing', module: 'marketing', permission: 'settings:write' },
	{ label: 'Segments', key: 'nav.segments', route: '/segments', icon: 'filter_alt', group: 'Marketing', module: 'marketing', permission: 'settings:write' },
	{ label: 'Loyalty', key: 'nav.loyalty', route: '/loyalty', icon: 'rewards', group: 'Marketing', module: 'marketing', permission: 'customers.read' },
	{ label: 'Reviews', key: 'nav.reviews', route: '/reviews', icon: 'rate_review', group: 'Marketing', module: 'commerce', permission: 'products:write' },
	{ label: 'Affiliates', key: 'nav.affiliates', route: '/affiliates', icon: 'group_add', group: 'Marketing', module: 'marketing', permission: 'settings:write' },
	{ label: 'Content', key: 'nav.content', route: '/content', icon: 'article', group: 'Marketing', module: 'commerce', permission: 'settings:write' },
	// Fulfillment — shipping and billing
	{ label: 'Fulfillments', key: 'nav.fulfillments', route: '/fulfillments', icon: 'local_shipping', group: 'Fulfillment', module: 'commerce', permission: 'orders.read' },
	{ label: 'Invoices', key: 'nav.invoices', route: '/invoices', icon: 'receipt_long', group: 'Fulfillment', module: 'commerce', permission: 'orders.read' },
	// Restaurant — dine-in operations
	{ label: 'Menu', key: 'nav.menu', route: '/menu', icon: 'restaurant_menu', group: 'Restaurant', module: 'restaurant', permission: 'menu.read' },
	{ label: 'Register', key: 'nav.pos', route: '/pos', icon: 'point_of_sale', group: 'Restaurant', module: 'restaurant', permission: ['orders.read', 'orders.create', 'payments.create'] },
	{ label: 'Shifts', key: 'nav.shifts', route: '/pos/shifts', icon: 'account_balance_wallet', group: 'Restaurant', module: 'restaurant', permission: 'payments.read' },
	{ label: 'Food Orders', key: 'nav.foodOrders', route: '/food-orders', icon: 'orders', group: 'Restaurant', module: 'restaurant', permission: ['orders.read', 'orders.create'] },
	{ label: 'Tables', key: 'nav.tables', route: '/tables', icon: 'table_restaurant', group: 'Restaurant', module: 'tables', permission: 'tables.read' },
	{ label: 'Kitchen', key: 'nav.kitchen', route: '/kitchen', icon: 'local_fire_department', group: 'Restaurant', module: 'kitchen', permission: 'kitchen.read' },
	{ label: 'KDS', key: 'nav.kds', route: '/kds', icon: 'monitor', group: 'Restaurant', module: 'kitchen', permission: 'kds.read' },
	{ label: 'Delivery', key: 'nav.delivery', route: '/delivery', icon: 'delivery_dining', group: 'Restaurant', module: 'delivery', permission: 'delivery.read' },
	// Insights — analytics, team and setup
	{ label: 'Analytics', key: 'nav.analytics', route: '/analytics', icon: 'insights', group: 'Insights', module: 'analytics', permission: 'analytics:read' },
	{ label: 'Profit & Loss', key: 'nav.profit', route: '/profit', icon: 'account_balance', group: 'Insights', module: 'analytics', permission: 'reports.read' },
	{ label: 'Audit Log', key: 'nav.audit', route: '/audit', icon: 'admin_panel_settings', group: 'Insights' },
	{ label: 'Staff', key: 'nav.staff', route: '/staff', icon: 'group', group: 'Insights', permission: 'staff.read' },
	{ label: 'Security', route: '/security', icon: 'lock', group: 'Insights' },
	{ label: 'Roles', key: 'nav.roles', route: '/roles', icon: 'manage_accounts', group: 'Insights', permission: 'staff.read' },
	{ label: 'API & Webhooks', key: 'nav.apiKeys', route: '/api-keys', icon: 'code', group: 'Insights', permission: ['settings.manage', 'settings:write'] },
	{ label: 'Modules', key: 'nav.modules', route: '/modules', icon: 'widgets', group: 'Insights', permission: 'settings.manage' },
	{ label: 'Theme', key: 'nav.theme', route: '/theme', icon: 'palette', group: 'Insights', permission: 'settings.manage' },
	{ label: 'Settings', key: 'nav.settings', route: '/settings', icon: 'settings', group: 'Insights', permission: ['settings.read', 'settings:write'] }
]

/** Material Symbols name per nav group (used by the shell for section headers). */
export const NAV_GROUP_ICONS: Record<string, string> = {
	General: 'dashboard',
	Catalog: 'inventory_2',
	Marketing: 'campaign',
	Fulfillment: 'local_shipping',
	Restaurant: 'restaurant',
	Insights: 'insights'
}

/** Sidebar order for groups (navGroups from session is a filtered record). */
export const NAV_GROUP_ORDER = ['General', 'Catalog', 'Marketing', 'Fulfillment', 'Restaurant', 'Insights']