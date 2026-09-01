import {
	fetchMe,
	login,
	logout,
	getAccessToken,
	setAccessToken,
	getSelectedOutletId,
	setSelectedOutletId
} from './api'
import type { AuthMerchant, AuthUser, ModuleId, Outlet, Permission, StoreSettings } from './types'
import { NAV_ITEMS } from './navigation'
import type { NavItem } from './navigation'

let user: AuthUser | null = $state(null)
let merchant: AuthMerchant | null = $state(null)
let settings: StoreSettings | null = $state(null)
let allowedOutlets: Outlet[] = $state([])
let enabledModules: ModuleId[] = $state([])
let selectedOutletId: string | null = $state(getSelectedOutletId())
let ready = $state(false)
let bootError = $state<'RATE_LIMITED' | 'SESSION_EXPIRED' | null>(null)

function applyMe(me: { data: MeData }) {
	user = me.data.user
	merchant = me.data.merchant
	settings = me.data.settings
	allowedOutlets = me.data.allowedOutlets ?? []
	enabledModules = me.data.enabledModules ?? []
	// Re-validate the persisted selection against what the server allows.
	const id = getSelectedOutletId()
	if (id && allowedOutlets.some((o) => o.id === id)) {
		selectedOutletId = id
	} else {
		selectedOutletId = allowedOutlets.length === 1 ? allowedOutlets[0].id : null
	}
	setSelectedOutletId(selectedOutletId)
}

interface MeData {
	user: AuthUser
	merchant: AuthMerchant
	settings: StoreSettings | null
	allowedOutlets?: Outlet[]
	selectedOutlet?: Outlet | null
	enabledModules?: ModuleId[]
}

/** Canonical frontend admin check — mirrors the server's isAdmin flag. */
function currentIsAdmin(): boolean {
	return user?.isAdmin === true
}

function navVisible(item: NavItem): boolean {
	if (item.module && !enabledModules.includes(item.module)) return false
	if (!item.permission) return true
	if (!user) return false
	if (currentIsAdmin()) return true
	const perms = Array.isArray(item.permission) ? item.permission : [item.permission]
	return perms.some((p) => user!.permissions.includes(p))
}

/** Navigation filtered by enabled modules + permissions (UX only; API enforces security). */
const visibleNav = $derived.by(() =>
	NAV_ITEMS.filter(navVisible).reduce<Record<string, NavItem[]>>((groups, item) => {
		;(groups[item.group] ??= []).push(item)
		return groups
	}, {})
)

export const session = {
	get user() {
		return user
	},
	get merchant() {
		return merchant
	},
	get settings() {
		return settings
	},
	get ready() {
		return ready
	},
	get bootError() {
		return bootError
	},
	get allowedOutlets() {
		return allowedOutlets
	},
	get enabledModules() {
		return enabledModules
	},
	get visibleNav() {
		return visibleNav
	},
	get selectedOutlet() {
		return allowedOutlets.find((o) => o.id === selectedOutletId) ?? null
	},
	get selectedOutletId() {
		return selectedOutletId
	},
	switchOutlet(outletId: string | null) {
		if (outletId === null) {
			selectedOutletId = null
			setSelectedOutletId(null)
			return
		}
		if (!allowedOutlets.some((o) => o.id === outletId)) return
		selectedOutletId = outletId
		setSelectedOutletId(outletId)
	},
	get isAuthenticated() {
		return !!user && !!getAccessToken()
	},
	get isAdmin() {
		return !!user && currentIsAdmin()
	},
	can(perm: Permission) {
		if (!user) return false
		if (currentIsAdmin()) return true
		return user.permissions.includes(perm)
	},
	async bootstrap() {
		if (!getAccessToken()) {
			ready = true
			return
		}
		bootError = null
		try {
			const me = await fetchMe()
			applyMe(me)
		} catch (e) {
			bootError = (e as { status?: number }).status === 429 ? 'RATE_LIMITED' : 'SESSION_EXPIRED'
			user = null
			merchant = null
			settings = null
			allowedOutlets = []
			enabledModules = []
			selectedOutletId = null
			setSelectedOutletId(null)
		} finally {
			ready = true
		}
	},
	async login(input: { email: string; password: string; merchantSlug?: string }) {
		const res = await login(input)
		user = res.data.user
		merchant = res.data.merchant
		try {
			const me = await fetchMe()
			applyMe(me)
		} catch {
			settings = null
		}
		return res
	},
	async logout() {
		await logout()
		setAccessToken(null)
		setSelectedOutletId(null)
		user = null
		merchant = null
		settings = null
		allowedOutlets = []
		enabledModules = []
		selectedOutletId = null
	}
}

export { setAccessToken }
