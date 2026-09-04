import { browser } from '$app/environment'
import { ApiError, storefrontApi } from './api'
import type { ShopperAddress, ShopperAddressInput, ShopperCustomer, ShopperSessionData, WishListItem } from './types'

const key = (slug: string) => `ecom:auth:${slug}`

interface RegisterInput {
	email: string
	password: string
	firstName?: string
	lastName?: string
	/** Required by the API when claiming a guest account that has past orders. */
	orderNumber?: string
}

class Account {
	slug = $state('')
	customer = $state<ShopperCustomer | null>(null)
	wishlist = $state<WishListItem[]>([])
	private token = ''
	private loadedSlug = ''
	private wishlistCustomer = ''

	private load(slug: string) {
		if (!browser) return
		try {
			const raw = localStorage.getItem(key(slug))
			if (raw) {
				const data = JSON.parse(raw) as ShopperSessionData
				this.token = data.token
				this.customer = data.customer
			} else {
				this.token = ''
				this.customer = null
			}
		} catch {
			this.token = ''
			this.customer = null
		}
		this.loadedSlug = slug
	}

	setSlug(slug: string) {
		if (slug === this.loadedSlug) return
		this.slug = slug
		this.load(slug)
	}

	get signedIn() {
		return Boolean(this.customer && this.token)
	}

	private persist(data: ShopperSessionData) {
		this.token = data.token
		this.customer = data.customer
		this.loadedSlug = this.slug
		if (browser && this.slug) {
			localStorage.setItem(key(this.slug), JSON.stringify(data))
		}
	}

	async register(fetchFn: typeof fetch, input: RegisterInput) {
		const data = await storefrontApi.registerAccount(fetchFn, this.slug, input)
		this.persist(data)
		await this.ensureWishlist(fetchFn)
		return data.customer
	}

	async login(fetchFn: typeof fetch, body: { email: string; password: string }) {
		const data = await storefrontApi.loginAccount(fetchFn, this.slug, body)
		this.persist(data)
		await this.ensureWishlist(fetchFn)
		return data.customer
	}

	async orders(fetchFn: typeof fetch, params: { page?: number | string; limit?: number | string } = {}) {
		if (!this.token || !this.customer) {
			throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		}
		return storefrontApi.myOrders(fetchFn, this.slug, this.token, params)
	}

	async submitReview(
		fetchFn: typeof fetch,
		body: { productId: string; rating: number; title?: string; body?: string }
	) {
		if (!this.token || !this.customer) {
			throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		}
		return storefrontApi.submitReview(fetchFn, this.slug, this.token, body)
	}

	/** Load the wishlist once per signed-in customer (no-op when already current). */
	async ensureWishlist(fetchFn: typeof fetch) {
		if (!browser || !this.signedIn || !this.customer) return
		if (this.wishlistCustomer === this.customer.id) return
		try {
			const data = await storefrontApi.wishlist(fetchFn, this.slug, this.token)
			this.wishlist = data.items
			this.wishlistCustomer = this.customer.id
		} catch (e) {
			if (this.isAuthError(e)) this.logout()
		}
	}

	isWishlisted(productId: string) {
		return this.wishlist.some((w) => w.productId === productId)
	}

	async addToWishlist(fetchFn: typeof fetch, productId: string) {
		if (!this.token || !this.customer) {
			throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		}
		await storefrontApi.wishlistAdd(fetchFn, this.slug, this.token, productId)
		if (!this.isWishlisted(productId)) {
			// refetch so card data (price/image/stock) stays accurate
			this.wishlistCustomer = ''
			await this.ensureWishlist(fetchFn)
		}
	}

	async removeFromWishlist(fetchFn: typeof fetch, productId: string) {
		if (!this.token) return
		await storefrontApi.wishlistRemove(fetchFn, this.slug, this.token, productId)
		this.wishlist = this.wishlist.filter((w) => w.productId !== productId)
	}

	logout() {
		this.token = ''
		this.customer = null
		this.wishlist = []
		this.wishlistCustomer = ''
		if (browser && this.loadedSlug) {
			localStorage.removeItem(key(this.loadedSlug))
		}
		// Force the next setSlug()/login() to reload cleanly.
		this.loadedSlug = ''
	}

	async changePassword(fetchFn: typeof fetch, input: { currentPassword: string; newPassword: string }) {
		const session = await storefrontApi.changePassword(fetchFn, this.slug, this.token, input)
		this.persist(session)
	}

	/** Request a password-reset email (public — always succeeds, no enumeration). */
	requestPasswordReset(fetchFn: typeof fetch, email: string) {
		return storefrontApi.forgotPassword(fetchFn, this.slug, email)
	}

	/** Complete a password reset with a single-use token (public). */
	resetPassword(fetchFn: typeof fetch, token: string, newPassword: string) {
		return storefrontApi.resetPassword(fetchFn, this.slug, token, newPassword)
	}

	/** Verify an email address with a single-use token (public GET). */
	verifyEmail(fetchFn: typeof fetch, token: string) {
		return storefrontApi.verifyEmail(fetchFn, this.slug, token)
	}

	/** Re-send the email-verification email for the signed-in shopper. */
	resendVerification(fetchFn: typeof fetch) {
		if (!this.token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		return storefrontApi.resendVerification(fetchFn, this.slug, this.token)
	}

	/** Update profile name/phone and refresh the cached session. */
	async updateProfile(fetchFn: typeof fetch, input: { firstName?: string; lastName?: string; phone?: string }) {
		if (!this.token || !this.customer) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		const updated = await storefrontApi.updateProfile(fetchFn, this.slug, this.token, input)
		this.customer = updated
		this.persist({ token: this.token, expiresIn: 0, customer: updated })
		return updated
	}

	async addresses(fetchFn: typeof fetch): Promise<ShopperAddress[]> {
		if (!this.token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		return (await storefrontApi.addresses.list(fetchFn, this.slug, this.token)).items
	}

	createAddress(fetchFn: typeof fetch, input: ShopperAddressInput) {
		if (!this.token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		return storefrontApi.addresses.create(fetchFn, this.slug, this.token, input)
	}

	updateAddress(fetchFn: typeof fetch, id: string, input: Partial<ShopperAddressInput>) {
		if (!this.token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		return storefrontApi.addresses.update(fetchFn, this.slug, this.token, id, input)
	}

	removeAddress(fetchFn: typeof fetch, id: string) {
		if (!this.token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		return storefrontApi.addresses.remove(fetchFn, this.slug, this.token, id)
	}

	setDefaultAddress(fetchFn: typeof fetch, id: string, type: 'shipping' | 'billing') {
		if (!this.token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in first')
		return storefrontApi.addresses.setDefault(fetchFn, this.slug, this.token, id, type)
	}

	/** True when a request failed because the stored session is no longer valid. */
	isAuthError(err: unknown) {
		return err instanceof ApiError && err.status === 401
	}
}

export const account = new Account()
