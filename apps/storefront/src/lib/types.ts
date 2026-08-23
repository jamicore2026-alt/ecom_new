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
	payments: {
		methods: Array<{ id: string; label: string; enabled: boolean }>
		currency: string
		providers?: Array<{ id: string; label: string }>
	}
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

export interface CartItemInput {
	productId: string
	variantId: string
	quantity: number
}

export interface CheckoutLine {
	productId: string
	variantId: string
	name: string
	sku: string | null
	price: number
	image: string | null
	optionValues: Record<string, string>
	quantity: number
	total: number
}

export interface CheckoutCoupon {
	code: string
	type: string
	value: number
	discount: number
	freeShipping: boolean
}

export interface CheckoutSummary {
	items: CheckoutLine[]
	subtotal: number
	discountTotal: number
	shippingTotal: number
	taxTotal: number
	total: number
	coupon: CheckoutCoupon | null
	shipping: { method: string; rate: number }
	currency: string
}

export interface AddressInput {
	name?: string
	line1?: string
	line2?: string
	city?: string
	state?: string
	postalCode?: string
	country?: string
	phone?: string
}

export interface CheckoutInput {
	items: CartItemInput[]
	couponCode?: string
	email: string
	shippingAddress: AddressInput
	billingAddress?: AddressInput
	paymentMethod: string
	notes?: string
}

export interface CheckoutPreviewInput {
	items: CartItemInput[]
	couponCode?: string
}

export interface CheckoutOrder {
	id: string
	orderNumber: string
	status: string
	paymentStatus: string
	total: number
	currency: string
	email: string
	createdAt: string
}

export interface ProviderCheckoutSession {
	id: string
	orderNumber: string
	requiresRedirect: true
	provider: string
	redirectUrl: string
	total: number
	currency: string
}

export interface PaymentSyncResult {
	orderNumber: string
	paymentStatus: string
	status: string
	updated: boolean
}

export interface OrderLineItem {
	id: string
	productId: string | null
	variantId: string | null
	name: string
	sku: string | null
	price: number
	quantity: number
	total: number
}

export interface OrderDetail extends CheckoutOrder {
	subtotal: number
	shippingTotal: number
	discountTotal: number
	taxTotal: number
	shippingAddress: AddressInput | null
	billingAddress: AddressInput | null
	notes: string | null
	items: OrderLineItem[]
}
