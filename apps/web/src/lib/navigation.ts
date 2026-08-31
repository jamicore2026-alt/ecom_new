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
	/** Material Symbols Outlined name, e.g. 'dashboard' */
	icon: string
	group: string
	/** Module that must be enabled for the merchant, or undefined for core. */
	module?: ModuleId
	/** Any-of permissions; owner/admin bypass via session.can(). */
	permission?: Permission | Permission[]
}

export const NAV_ITEMS: NavItem[] = [
	{ label: 'Overview', route: '/dashboard', icon: 'dashboard', group: 'General' },
	{ label: 'Orders', route: '/orders', icon: 'receipt_long', group: 'General', module: 'commerce', permission: ['orders.read', 'orders:write'] },
	{ label: 'Customers', route: '/customers', icon: 'group', group: 'General', module: 'commerce', permission: 'customers.read' },
	{ label: 'Products', route: '/products', icon: 'inventory_2', group: 'Sell', module: 'commerce', permission: ['products.read', 'products:write'] },
	{ label: 'Inventory', route: '/inventory', icon: 'warehouse', group: 'Sell', module: 'inventory', permission: ['inventory.read', 'inventory:write'] },
	{ label: 'Warehouses', route: '/warehouses', icon: 'warehouse', group: 'Sell', module: 'inventory', permission: ['inventory.read', 'inventory:write'] },
	{ label: 'Transfers', route: '/transfers', icon: 'swap_horiz', group: 'Sell', module: 'inventory', permission: ['inventory.read', 'inventory:write'] },
	{ label: 'Discounts', route: '/discounts', icon: 'sell', group: 'Sell', module: 'marketing', permission: 'discounts:write' },
	{ label: 'Campaigns', route: '/campaigns', icon: 'campaign', group: 'Sell', module: 'marketing', permission: 'settings:write' },
	{ label: 'Segments', route: '/segments', icon: 'filter_alt', group: 'Sell', module: 'marketing', permission: 'settings:write' },
	{ label: 'Loyalty', route: '/loyalty', icon: 'rewards', group: 'Sell', module: 'marketing', permission: 'customers.read' },
	{ label: 'Reviews', route: '/reviews', icon: 'rate_review', group: 'Sell', module: 'commerce', permission: 'products:write' },
	{ label: 'Menu', route: '/menu', icon: 'restaurant_menu', group: 'Restaurant', module: 'restaurant', permission: 'menu.read' },
	{ label: 'Food Orders', route: '/food-orders', icon: 'orders', group: 'Restaurant', module: 'restaurant', permission: ['orders.read', 'orders.create'] },
	{ label: 'Tables', route: '/tables', icon: 'table_restaurant', group: 'Restaurant', module: 'tables', permission: 'tables.read' },
	{ label: 'Kitchen', route: '/kitchen', icon: 'local_fire_department', group: 'Restaurant', module: 'kitchen', permission: 'kitchen.read' },
	{ label: 'KDS', route: '/kds', icon: 'monitor', group: 'Restaurant', module: 'kitchen', permission: 'kds.read' },
	{ label: 'Delivery', route: '/delivery', icon: 'delivery_dining', group: 'Restaurant', module: 'delivery', permission: 'delivery.read' },
	{ label: 'Analytics', route: '/analytics', icon: 'insights', group: 'Insights', module: 'analytics', permission: 'analytics:read' },
	{ label: 'Profit & Loss', route: '/profit', icon: 'account_balance', group: 'Insights', module: 'analytics', permission: 'reports.read' },
	{ label: 'Audit Log', route: '/audit', icon: 'admin_panel_settings', group: 'Insights' },
	{ label: 'Staff', route: '/staff', icon: 'group', group: 'Insights', permission: 'staff.read' },
	{ label: 'Roles', route: '/roles', icon: 'manage_accounts', group: 'Insights', permission: 'staff.read' },
	{ label: 'API & Webhooks', route: '/api-keys', icon: 'code', group: 'Insights', permission: ['settings.manage', 'settings:write'] },
	{ label: 'Settings', route: '/settings', icon: 'settings', group: 'Insights', permission: ['settings.read', 'settings:write'] }
]

/** Material Symbols name per nav group (used by the shell for section headers). */
export const NAV_GROUP_ICONS: Record<string, string> = {
	General: 'dashboard',
	Sell: 'storefront',
	Restaurant: 'restaurant',
	Insights: 'insights'
}