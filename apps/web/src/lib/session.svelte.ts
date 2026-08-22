import { fetchMe, login, logout, getAccessToken, setAccessToken } from './api'
import type { AuthMerchant, AuthUser, Permission, StoreSettings } from './types'

let user: AuthUser | null = $state(null)
let merchant: AuthMerchant | null = $state(null)
let settings: StoreSettings | null = $state(null)
let ready = $state(false)

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
	get isAuthenticated() {
		return !!user && !!getAccessToken()
	},
	get isAdmin() {
		return !!user && (user.role === 'owner' || user.role === 'admin')
	},
	can(perm: Permission) {
		if (!user) return false
		if (user.role === 'owner' || user.role === 'admin') return true
		return user.permissions.includes(perm)
	},
	async bootstrap() {
		if (!getAccessToken()) {
			ready = true
			return
		}
		try {
			const me = await fetchMe()
			user = me.data.user
			merchant = me.data.merchant
			settings = me.data.settings
		} catch {
			user = null
			merchant = null
			settings = null
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
			settings = me.data.settings
		} catch {
			settings = null
		}
		return res
	},
	async logout() {
		await logout()
		setAccessToken(null)
		user = null
		merchant = null
		settings = null
	}
}

export { setAccessToken }
