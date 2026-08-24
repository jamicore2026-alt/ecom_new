import { browser } from '$app/environment'
import { ApiError, storefrontApi } from './api'
import type { ShopperCustomer, ShopperSessionData, WishListItem } from './types'

const key = (slug: string) => `ecom:auth:${slug}`

interface RegisterInput {
	email: string
	password: string
	firstName?: string
	lastName?: string
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
	}

	/** True when a request failed because the stored session is no longer valid. */
	isAuthError(err: unknown) {
		return err instanceof ApiError && err.status === 401
	}
}

export const account = new Account()
