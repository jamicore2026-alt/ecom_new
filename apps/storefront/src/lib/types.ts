export interface StoreMerchant {
	id: string
	name: string
	slug: string
	currency: string
	timezone: string
}

export interface StoreSettings {
	name: string
	logo: string | null
	announcement: string
	address: Record<string, unknown>
	currency: string
	timezone: string
}

export interface StoreInfo {
	merchant: StoreMerchant
	settings: StoreSettings
	payments: { methods: Array<{ id: string; label: string; enabled: boolean }>; currency: string }
	shipping: { zones: Array<{ name: string; countries: string[]; rate: number; freeAbove?: number }>; freeShippingThreshold: number }
	taxes: { autoCalculate: boolean; rates: Array<{ region: string; rate: number }> }
}

export interface Category {
	id: string
	name: string
	slug: string
	image: string | null
	sortOrder: number
	productCount: number
	children: Category[]
}

export interface CategoryRef {
	id: string
	name: string
	slug: string
	image: string | null
}

export interface ProductSummary {
	id: string
	merchantId: string
	name: string
	slug: string
	description: string
	price: number
	compareAtPrice: number | null
	sku: string | null
	trackInventory: boolean
	lowStockThreshold: number
	stock: number
	variantCount: number
	image: string | null
	category: CategoryRef | null
}

export interface ProductVariant {
	id: string
	sku: string | null
	price: number
	compareAtPrice: number | null
	inventory: number
	optionValues: Record<string, string>
	image: string | null
}

export interface ProductDetail {
	id: string
	name: string
	slug: string
	description: string
	price: number
	compareAtPrice: number | null
	sku: string | null
	trackInventory: boolean
	lowStockThreshold: number
	image: string | null
	stock: number
	variants: ProductVariant[]
	category: CategoryRef | null
	related: ProductSummary[]
}

export interface Meta {
	page: number
	limit: number
	total: number
	totalPages: number
}

export interface Page<T> {
	items: T[]
	meta: Meta
}

export interface CategoryTree {
	items: Category[]
}
