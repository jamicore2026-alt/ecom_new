import { browser } from '$app/environment'
import { storefrontApi } from './api'
import { account } from './account.svelte'

export interface CartLine {
	productId: string
	variantId: string
	name: string
	sku: string | null
	price: number
	compareAtPrice: number | null
	image: string | null
	optionValues: Record<string, string>
	quantity: number
}

const key = (slug: string) => `ecom:cart:${slug}`
const cartIdKey = (slug: string) => `ecom:cartid:${slug}`

const toSnapshot = (line: CartLine) => ({
	variantId: line.variantId,
	productId: line.productId,
	name: line.name,
	price: line.price,
	quantity: line.quantity,
	image: line.image ?? null,
	slug: undefined as string | undefined
})

class Cart {
	slug = $state('')
	items = $state<CartLine[]>([])
	private loadedSlug = ''
	private serverCartId = ''
	private persistTimer: ReturnType<typeof setTimeout> | null = null

	private load(slug: string) {
		if (!browser) return
		try {
			const raw = localStorage.getItem(key(slug))
			// Corrupt/tampered storage must never crash the whole storefront.
			const parsed = raw ? JSON.parse(raw) : null
			this.items = Array.isArray(parsed) ? (parsed as CartLine[]) : []
		} catch {
			this.items = []
		}
		this.serverCartId = browser ? (localStorage.getItem(cartIdKey(slug)) ?? '') : ''
		this.loadedSlug = slug
	}

	setSlug(slug: string) {
		if (slug === this.loadedSlug) return
		this.slug = slug
		this.load(slug)
	}

	private saveLocal() {
		if (!browser || !this.loadedSlug) return
		localStorage.setItem(key(this.loadedSlug), JSON.stringify(this.items))
	}

	/** Debounced server-side snapshot so abandoned-cart recovery can restore items. */
	private persistServer() {
		if (!browser || !this.loadedSlug) return
		if (this.persistTimer) clearTimeout(this.persistTimer)
		this.persistTimer = setTimeout(() => {
			const snapshot = this.items.map(toSnapshot)
			const customerId = account.customer?.id
			storefrontApi
				.saveCart(fetch, this.loadedSlug, {
					cartId: this.serverCartId || undefined,
					customerId,
					items: snapshot
				})
				.then(({ cart }) => {
					this.serverCartId = cart.id
					localStorage.setItem(cartIdKey(this.loadedSlug), cart.id)
				})
				.catch(() => {})
		}, 800)
	}

	add(line: CartLine) {
		const idx = this.items.findIndex((i) => i.variantId === line.variantId)
		if (idx >= 0) this.items[idx].quantity = Math.min(99, this.items[idx].quantity + line.quantity)
		else this.items = [...this.items, line]
		this.saveLocal()
		this.persistServer()
		if (browser && this.loadedSlug) {
			fetch(`/api/store/${this.loadedSlug}/events`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type: 'cart_add' }),
				keepalive: true
			}).catch(() => {})
		}
	}

	setQuantity(variantId: string, quantity: number) {
		const idx = this.items.findIndex((i) => i.variantId === variantId)
		if (idx >= 0) {
			this.items[idx].quantity = Math.max(1, Math.min(99, quantity))
			this.saveLocal()
			this.persistServer()
		}
	}

	remove(variantId: string) {
		this.items = this.items.filter((i) => i.variantId !== variantId)
		this.saveLocal()
		this.persistServer()
	}

	clear() {
		this.items = []
		this.saveLocal()
		if (this.persistTimer) clearTimeout(this.persistTimer)
	}

	/** Restore a recovered cart's items (client revalidates stock on next checkout). */
	restore(items: Array<{ variantId: string; productId?: string; name: string; price: number; quantity: number; image?: string | null }>, cartId: string) {
		this.items = items.map((i) => ({
			productId: i.productId ?? '',
			variantId: i.variantId,
			name: i.name,
			sku: null,
			price: i.price,
			compareAtPrice: null,
			image: i.image ?? null,
			optionValues: {},
			quantity: i.quantity
		}))
		this.serverCartId = cartId
		if (browser && this.loadedSlug) localStorage.setItem(cartIdKey(this.loadedSlug), cartId)
		this.saveLocal()
	}

	get count() {
		return this.items.reduce((n, i) => n + i.quantity, 0)
	}

	/** The server-side cart id (if persisted) to link an order to a tracked cart. */
	get persistedCartId() {
		return this.serverCartId || undefined
	}

	get subtotal() {
		return this.items.reduce((n, i) => n + i.price * i.quantity, 0)
	}
}

export const cart = new Cart()
