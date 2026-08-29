import type { ModuleId, Permission } from './types'

/**
 * Centralized navigation metadata (Phase 2).
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
	icon: string
	group: string
	/** Module that must be enabled for the merchant, or undefined for core. */
	module?: ModuleId
	/** Any-of permissions; owner/admin bypass via session.can(). */
	permission?: Permission | Permission[]
}

export const NAV_ITEMS: NavItem[] = [
	{ label: 'Overview', route: '/dashboard', icon: 'grid', group: 'General' },
	{ label: 'Orders', route: '/orders', icon: 'cart', group: 'General', module: 'commerce', permission: ['orders.read', 'orders:write'] },
	{ label: 'Customers', route: '/customers', icon: 'users', group: 'General', module: 'commerce', permission: 'customers.read' },
	{ label: 'Products', route: '/products', icon: 'box', group: 'Sell', module: 'commerce', permission: ['products.read', 'products:write'] },
	{ label: 'Menu', route: '/menu', icon: 'utensils', group: 'Restaurant', module: 'restaurant', permission: 'menu.read' },
	{ label: 'Food Orders', route: '/food-orders', icon: 'receipt', group: 'Restaurant', module: 'restaurant', permission: ['orders.read', 'orders.create'] },
	{ label: 'Tables', route: '/tables', icon: 'layout', group: 'Restaurant', module: 'tables', permission: 'tables.read' },
	{ label: 'Kitchen', route: '/kitchen', icon: 'flame', group: 'Restaurant', module: 'kitchen', permission: 'kitchen.read' },
	{ label: 'KDS', route: '/kds', icon: 'monitor', group: 'Restaurant', module: 'kitchen', permission: 'kds.read' },
	{ label: 'Delivery', route: '/delivery', icon: 'bike', group: 'Restaurant', module: 'delivery', permission: 'delivery.read' },
	{ label: 'Inventory', route: '/inventory', icon: 'layers', group: 'Sell', module: 'inventory', permission: ['inventory.read', 'inventory:write'] },
	{ label: 'Discounts', route: '/discounts', icon: 'tag', group: 'Sell', module: 'marketing', permission: 'discounts:write' },
	{ label: 'Reviews', route: '/reviews', icon: 'star', group: 'Sell', module: 'commerce', permission: 'products:write' },
	{ label: 'Analytics', route: '/analytics', icon: 'chart', group: 'Insights', module: 'analytics', permission: 'analytics:read' },
	{ label: 'Audit Log', route: '/audit', icon: 'shield', group: 'Insights' },
	{ label: 'Settings', route: '/settings', icon: 'cog', group: 'Insights', permission: ['settings.read', 'settings:write'] }
]

export const NAV_ICONS: Record<string, string> = {
	grid: 'M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm0 6h16M9 4v16',
	box: 'M20 7l-8-4-8 4v10l8 4 8-4V7zm-8-4v10m8-6l-8 4m0 0l-8-4m8 4v8',
	layers: 'M12 2l9 5-9 5-9-5 9-5zm-9 10l9 5 9-5m-18 5l9 5 9-5',
	cart: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6a1 1 0 00.9 1.4H17m-10 0a2 2 0 100 4 2 2 0 000-4zm8 0a2 2 0 100 4 2 2 0 000-4z',
	users: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M16 3.13a4 4 0 010 7.75M12 7a4 4 0 11-8 0 4 4 0 018 0z',
	tag: 'M7 7h.01M7 3h5a2 2 0 011.42.59l7 7a2 2 0 010 2.82l-6.01 6.01a2 2 0 01-2.83 0l-7-7A2 2 0 013 11V5a2 2 0 012-2zm1 5a1 1 0 11-2 0 1 1 0 012 0z',
	star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.518-4.674z',
	shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
	chart: 'M3 3v18h18M8 17V9m5 8V5m5 12v-6',
	cog: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
	utensils: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 2v20M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7',
	bike: 'M5 22a4 4 0 100-8 4 4 0 000 8zm14 0a4 4 0 100-8 4 4 0 000 8zM5 16l3-8h3m-3-2h4l5 7h3m-6-7h2',
	flame: 'M12 2c3 2.5 5 5.5 5 9a5 5 0 01-10 0c0-1.5.5-3 1.5-4.5C9 8 10 9.5 11 10c0-2-2-4-2-8 1 1 2 2 3 0z',
	receipt: 'M4 2h16v20l-2-1.5L16 22l-2-1.5L12 22l-2-1.5L8 22l-2-1.5L4 22V2zM8 7h8M8 11h8M8 15h5',
	layout: 'M4 4h16v16H4V4zm0 7h16M9 11v9',
	monitor: 'M2 3h20v14H2V3zm6 18h8m-4-4v4'
}
