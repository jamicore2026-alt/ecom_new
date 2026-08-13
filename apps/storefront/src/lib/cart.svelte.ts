import { browser } from '$app/environment'

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

class Cart {
	slug = $state('')
	items = $state<CartLine[]>([])
	private loadedSlug = ''

	private load(slug: string) {
		if (!browser) return
		try {
			const raw = localStorage.getItem(key(slug))
			this.items = raw ? (JSON.parse(raw) as CartLine[]) : []
		} catch {
			this.items = []
		}
		this.loadedSlug = slug
	}

	setSlug(slug: string) {
		if (slug === this.loadedSlug) return
		this.slug = slug
		this.load(slug)
	}

	private save() {
		if (!browser || !this.loadedSlug) return
		localStorage.setItem(key(this.loadedSlug), JSON.stringify(this.items))
	}

	add(line: CartLine) {
		const idx = this.items.findIndex((i) => i.variantId === line.variantId)
		if (idx >= 0) this.items[idx].quantity = Math.min(99, this.items[idx].quantity + line.quantity)
		else this.items = [...this.items, line]
		this.save()
	}

	setQuantity(variantId: string, quantity: number) {
		const idx = this.items.findIndex((i) => i.variantId === variantId)
		if (idx >= 0) {
			this.items[idx].quantity = Math.max(1, Math.min(99, quantity))
			this.save()
		}
	}

	remove(variantId: string) {
		this.items = this.items.filter((i) => i.variantId !== variantId)
		this.save()
	}

	clear() {
		this.items = []
		this.save()
	}

	get count() {
		return this.items.reduce((n, i) => n + i.quantity, 0)
	}

	get subtotal() {
		return this.items.reduce((n, i) => n + i.price * i.quantity, 0)
	}
}

export const cart = new Cart()
