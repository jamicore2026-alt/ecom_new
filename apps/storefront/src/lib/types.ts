export interface StoreMerchant {
	id: string
	name: string
	slug: string
	currency: string
	timezone: string
	country: string | null
}

export type ShippingRuleType = 'pin' | 'city' | 'state' | 'country' | 'default'

export interface ShippingRule {
	id: string
	name: string
	type: ShippingRuleType
	country?: string
	state?: string
	city?: string
	postalCode?: string
	rate: number
	freeAbove?: number
	enabled: boolean
}

export type CheckoutField = 'email' | 'phone' | 'name' | 'line1' | 'line2' | 'city' | 'state' | 'postalCode' | 'country'

export type CheckoutFieldRequirements = Partial<Record<CheckoutField, boolean>>

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
	shipping: { zones: Array<{ name: string; countries: string[]; rate: number; freeAbove?: number }>; rules: ShippingRule[]; freeShippingThreshold: number }
	checkout: { requiredFields: CheckoutFieldRequirements }
	taxes: { autoCalculate: boolean; rates: Array<{ region: string; rate: number }> }
}

export interface Category {
	id: string
	name: string
	nameAr: string | null
	slug: string
	image: string | null
	sortOrder: number
	productCount: number
	children: Category[]
}

export interface CategoryRef {
	id: string
	name: string
	nameAr: string | null
	slug: string
	image: string | null
}

export interface ProductSummary {
	id: string
	merchantId: string
	name: string
	nameAr: string | null
	slug: string
	description: string
	descriptionAr: string
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
	unlimited: boolean
	optionValues: Record<string, string>
	optionValuesAr: Record<string, string>
	image: string | null
}

export interface ProductOptionValue {
	value: string
	valueAr: string | null
	priceAdjustment: number
	quantity: number | null
}

export interface ProductOption {
	id: string
	name: string
	nameAr: string | null
	type: 'radio' | 'checkbox' | 'select' | 'swatch' | 'number' | 'text'
	required: boolean
	minSelections: number
	maxSelections: number
	perValueQuantity: boolean
	values: ProductOptionValue[]
}

export interface ProductDetail {
	id: string
	name: string
	nameAr: string | null
	slug: string
	description: string
	descriptionAr: string
	price: number
	compareAtPrice: number | null
	sku: string | null
	trackInventory: boolean
	lowStockThreshold: number
	image: string | null
	images?: string[]
	stock: number
	rating?: { average: number; count: number } | null
	variants: ProductVariant[]
	options?: ProductOption[]
	category: CategoryRef | null
	related: ProductSummary[]
}

export interface ProductReview {
	id: string
	authorName: string
	rating: number
	title: string | null
	body: string | null
	createdAt: string
	verifiedPurchase: boolean
}

export interface SubmittedReview {
	id: string
	productId: string
	rating: number
	title: string | null
	body: string | null
	status: 'pending' | 'approved' | 'rejected'
	createdAt: string
}

export interface WishListItem {
	productId: string
	name: string
	slug: string
	price: number
	compareAtPrice: number | null
	image: string | null
	stock: number
	variantId: string
	optionCount: number
	savedAt: string
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
	selections?: Array<{ optionId: string; values: string[] }>
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
	referralCode?: string
	shippingAddress: AddressInput
	billingAddress?: AddressInput
	paymentMethod: string
	notes?: string
	cartId?: string
	/** Client-generated key so a retry of the same attempt can't double-order. */
	idempotencyKey?: string
}

export interface CheckoutPreviewInput {
	items: CartItemInput[]
	couponCode?: string
	/** Full destination so previewed shipping/tax match the final order. */
	shippingAddress?: { country?: string; state?: string; city?: string; postalCode?: string }
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
	requiresRedirect: boolean
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

export interface ShopperCustomer {
	id: string
	merchantId: string
	email: string
	firstName: string | null
	lastName: string | null
	phone: string | null
	emailVerified: boolean
	ordersCount: number
	totalSpent: number
	createdAt: string
}

export interface ShopperAddressInput {
	label?: string
	addressType?: 'shipping' | 'billing' | 'both'
	name?: string
	company?: string
	line1: string
	line2?: string
	city?: string
	state?: string
	postalCode?: string
	country: string
	phone?: string
}

export interface ShopperAddress {
	id: string
	label: string
	addressType: 'shipping' | 'billing' | 'both'
	name: string | null
	company: string | null
	line1: string
	line2: string | null
	city: string | null
	state: string | null
	postalCode: string | null
	country: string
	phone: string | null
	isDefaultShipping: boolean
	isDefaultBilling: boolean
	createdAt: string
	updatedAt: string | null
}

export interface ShopperSessionData {
	token: string
	expiresIn: number
	customer: ShopperCustomer
}

export interface ShopperOrderSummary {
	id: string
	orderNumber: string
	status: string
	paymentStatus: string
	paymentMethod?: string | null
	subtotal: number
	shippingTotal: number
	discountTotal: number
	taxTotal: number
	total: number
	currency: string
	createdAt: string
	itemCount: number
	items: Array<{ name: string; sku: string | null; price: number; quantity: number; total: number }>
}
