// API contract types — mirror the backend response shapes exactly.

export interface ApiErrorBody {
	success: false
	error: {
		code: string
		message: string
		fields?: Array<{ path: string; message: string }>
	}
}

export interface PaginationMeta {
	page: number
	limit: number
	total: number
	totalPages: number
}

export interface Paginated<T> {
	items: T[]
	meta: PaginationMeta
}

// ---- auth ----

export interface AuthUser {
	id: string
	name: string
	email: string
	role: 'owner' | 'admin' | 'staff'
	permissions: string[]
	status: string
}

export interface AuthMerchant {
	id: string
	name: string
	slug: string
	currency: string
}

export interface AuthResponse {
	success: boolean
	data: {
		accessToken: string
		refreshToken: string
		expiresIn: number
		user: AuthUser
		merchant: AuthMerchant
	}
}

export interface MeResponse {
	success: boolean
	data: {
		user: AuthUser
		merchant: AuthMerchant
		settings: StoreSettings | null
		allowedOutlets: Outlet[]
		selectedOutlet: Outlet | null
		enabledModules: ModuleId[]
	}
}

// ---- shared rows ----

export interface Address {
	name?: string
	line1?: string
	line2?: string
	city?: string
	state?: string
	postalCode?: string
	country?: string
	phone?: string
}

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
export type OrderPaymentStatus = 'unpaid' | 'paid' | 'partially_refunded' | 'refunded' | 'failed'
export type OrderFulfillmentStatus = 'unfulfilled' | 'fulfilled'
export type ReturnStatus = 'pending' | 'approved' | 'rejected' | 'restocked'
export type RefundMethod = 'original'
export type RefundStatus = 'pending' | 'completed'
export type ProductStatus = 'active' | 'draft' | 'archived'
export type CouponType = 'percentage' | 'fixed' | 'free_shipping'
export type PromotionType = 'discount_on_products' | 'buy_x_get_y'
export type InventoryReason = 'sale' | 'adjustment' | 'purchase' | 'return' | 'cancel'
export type UserRole = 'owner' | 'admin' | 'staff'
export type ModuleId = 'commerce' | 'restaurant' | 'pos' | 'kitchen' | 'tables' | 'delivery' | 'inventory' | 'marketing' | 'analytics'
export type OutletStatus = 'active' | 'inactive' | 'archived'

export interface Outlet {
	id: string
	merchantId: string
	name: string
	code: string
	address?: Address
	status: OutletStatus
	createdAt?: string
	updatedAt?: string
}

export type Permission =
	| 'products:write'
	| 'orders:write'
	| 'inventory:write'
	| 'discounts:write'
	| 'settings:write'
	| 'analytics:read'
	| 'orders.read'
	| 'orders.create'
	| 'orders.update'
	| 'orders.cancel'
	| 'products.read'
	| 'products.create'
	| 'products.update'
	| 'products.delete'
	| 'menu.read'
	| 'menu.manage'
	| 'kitchen.read'
	| 'kitchen.manage'
	| 'kds.read'
	| 'kds.manage'
	| 'tables.read'
	| 'tables.manage'
	| 'delivery.read'
	| 'delivery.assign'
	| 'delivery.manage'
	| 'drivers.read'
	| 'drivers.manage'
	| 'inventory.read'
	| 'inventory.adjust'
	| 'inventory.manage'
	| 'payments.read'
	| 'payments.create'
	| 'payments.refund'
	| 'reports.read'
	| 'staff.read'
	| 'staff.manage'
	| 'customers.read'
	| 'settings.read'
	| 'settings.manage'

export interface Product {
	id: string
	merchantId: string
	categoryId: string | null
	sku: string | null
	barcode: string | null
	name: string
	slug: string
	description: string
	price: number
	compareAtPrice: number | null
	cost: number
	trackInventory: boolean
	lowStockThreshold: number
	status: ProductStatus
	createdAt: string
	updatedAt: string
}

export interface ProductImage {
	id: string
	productId: string
	url: string
	altText: string | null
	sortOrder: number
	createdAt: string
}

export interface ProductVariant {
	id: string
	productId: string
	optionValues: Record<string, string>
	sku: string | null
	price: number
	compareAtPrice: number | null
	inventory: number
	image: string | null
	createdAt: string
}

export interface Category {
	id: string
	merchantId: string
	parentId: string | null
	name: string
	slug: string
	image: string | null
	sortOrder: number
	status: string
	createdAt: string
	children?: Category[]
}

export interface ProductListItem extends Product {
	stock: number
	variantCount: number
	category: Category | null
	images?: ProductImage[]
	primaryImage?: string | null
}

export interface ProductDetail extends Product {
	variants: ProductVariant[]
	category: Category | null
	stock: number
	images?: ProductImage[]
	primaryImage?: string | null
}

export interface Customer {
	id: string
	merchantId: string
	email: string
	firstName: string | null
	lastName: string | null
	phone: string | null
	tags: string[]
	totalSpent: number
	ordersCount: number
	lastOrderAt: string | null
	createdAt: string
}

export interface CustomerDetail extends Customer {
	netSpent: number
	refundTotal: number
	avgOrderValue: number
}

export interface OrderListItem {
	id: string
	orderNumber: string
	status: OrderStatus
	paymentStatus: OrderPaymentStatus
	fulfillmentStatus: OrderFulfillmentStatus
	total: number
	subtotal: number
	discountTotal: number
	shippingTotal: number
	taxTotal: number
	currency: string
	createdAt: string
	updatedAt: string
	customerId: string | null
	customerName: string
	customerEmail: string | null
	itemCount: number
}

export interface OrderItem {
	id: string
	orderId: string
	productId: string | null
	variantId: string | null
	name: string
	sku: string | null
	price: number
	quantity: number
	total: number
	optionValues: Record<string, string> | null
}

export interface ReturnRecord {
	id: string
	merchantId: string
	orderId: string
	orderItemId: string | null
	quantity: number
	amount: number
	reason: string | null
	status: ReturnStatus
	createdAt: string
}

export interface Refund {
	id: string
	merchantId: string
	orderId: string
	returnId: string | null
	amount: number
	method: RefundMethod
	status: RefundStatus
	createdAt: string
}

export interface OrderDetail {
	id: string
	merchantId: string
	customerId: string | null
	orderNumber: string
	status: OrderStatus
	paymentStatus: OrderPaymentStatus
	fulfillmentStatus: OrderFulfillmentStatus
	subtotal: number
	shippingTotal: number
	discountTotal: number
	taxTotal: number
	total: number
	currency: string
	shippingAddress: Address | null
	billingAddress: Address | null
	notes: string | null
	createdAt: string
	updatedAt: string
	customer: Customer | null
	items: OrderItem[]
	returns: ReturnRecord[]
	refunds: Refund[]
}

export interface InventoryRow {
	id: string
	productId: string
	sku: string | null
	optionValues: Record<string, string>
	price: number
	compareAtPrice: number | null
	inventory: number
	image: string | null
	createdAt: string
	productName: string
	productStatus: ProductStatus
	productSku: string | null
	lowStockThreshold: number
	trackInventory: boolean
	categoryName: string | null
}

export interface InventoryHistoryRow {
	id: string
	variantId: string
	change: number
	beforeValue: number
	afterValue: number
	reason: InventoryReason
	reference: string | null
	createdAt: string
	productId: string
	sku: string | null
	productName: string
	optionValues: Record<string, string>
}

export interface Coupon {
	id: string
	merchantId: string
	code: string
	type: CouponType
	value: number
	minSubtotal: number
	usageLimit: number | null
	usedCount: number
	startsAt: string | null
	endsAt: string | null
	status: 'active' | 'disabled'
	createdAt: string
}

export interface Promotion {
	id: string
	merchantId: string
	name: string
	type: PromotionType
	discountPercent: number
	appliesTo: {
		scope: 'all' | 'products' | 'category'
		productIds?: string[]
		categoryId?: string
	}
	startsAt: string | null
	endsAt: string | null
	status: 'active' | 'disabled'
	createdAt: string
}

export interface StoreSettings {
	merchantId: string
	name: string
	logo: string | null
	address: Address
	currency: string
	timezone: string
	announcement: string
	updatedAt: string
}

export interface PaymentSettings {
	merchantId: string
	methods: Array<{ id: string; label: string; enabled: boolean }>
	currency: string
	updatedAt: string
}

export interface PaymentCredentialField {
	key: string
	label: string
	secret: boolean
	required: boolean
}

export interface PaymentProviderView {
	id: string
	label: string
	description: string
	countries: string[] | null
	currencies: string[]
	credentialFields: PaymentCredentialField[]
	enabled: boolean
	mode: 'test' | 'live'
	country: string | null
	configured: boolean
	updatedAt: string | null
}

export interface ShippingSettings {
	merchantId: string
	zones: Array<{ name: string; countries: string[]; rate: number; freeAbove?: number }>
	freeShippingThreshold: number
	updatedAt: string
}

export interface TaxSettings {
	merchantId: string
	autoCalculate: boolean
	rates: Array<{ region: string; rate: number }>
	updatedAt: string
}

export interface NotificationSettings {
	merchantId: string
	enabled: boolean
	fromName: string | null
	fromEmail: string | null
	templates: Record<string, boolean>
}

export interface StaffMember {
	id: string
	name: string
	email: string
	role: UserRole
	permissions: Permission[]
	status: string
	createdAt: string
}

// ---- overview ----

export interface OverviewData {
	todaySales: number
	ordersToday: number
	avgOrderValue: number
	pendingOrders: number
	lowStockCount: number
	outOfStockCount: number
	salesChart: Array<{ date: string; revenue: number; orders: number }>
	recentOrders: Array<{
		id: string
		orderNumber: string
		status: OrderStatus
		paymentStatus: OrderPaymentStatus
		total: number
		currency: string
		createdAt: string
		customerName: string
		customerEmail: string | null
	}>
	topProducts: Array<{
		productId: string
		name: string
		revenue: number
		quantity: number
	}>
	currency: string
	todayKey: string
}

// ---- analytics ----

export interface SalesAnalytics {
	series: Array<{ date: string; revenue: number; orders: number }>
	revenue: number
	orders: number
	refunds: number
	aov: number
	netRevenue: number
	interval: string
	from: string
	to: string
	comparison: {
		previous: {
			series: Array<{ date: string; revenue: number; orders: number }>
			revenue: number
			orders: number
			refunds: number
			aov: number
		}
		revenueDeltaPct: number
		ordersDeltaPct: number
	}
}

export interface ProductAnalytics {
	top: Array<{ productId: string; name: string; sku: string | null; revenue: number; quantity: number; ordersCount: number }>
	categoryBreakdown: Array<{ categoryId: string | null; categoryName: string | null; revenue: number; quantity: number }>
	lowPerformers: Array<{ productId: string; name: string; sku: string | null; revenue: number; quantity: number }>
	totalProducts: number
}

export interface CustomerAnalytics {
	newCustomers: number
	activeCustomers: number
	returningCustomers: number
	repeatPurchaseRate: number
	monthlyNewCustomers: Array<{ month: string; count: number }>
	topSpenders: Customer[]
	from: string
	to: string
}

export interface ConversionAnalytics {
	views: number
	cartAdds: number
	checkouts: number
	paid: number
	conversionRate: number
	funnel: { viewToCart: number; cartToCheckout: number; checkoutToPaid: number }
	byChannel: Array<{
		channel: string
		views: number
		cartAdds: number
		checkouts: number
		paid: number
		conversionRate: number
	}>
	from: string
	to: string
	comparison: { previous: { conversionRate: number }; conversionDeltaPct: number; viewsDeltaPct: number }
}

export interface Review {
	id: string
	productId: string
	productName: string | null
	productSlug: string | null
	customerId: string | null
	customerEmail: string | null
	authorName: string
	rating: number
	title: string | null
	body: string | null
	status: 'pending' | 'approved' | 'rejected'
	createdAt: string
	updatedAt: string
}

export interface AuditEntry {
	id: string
	merchantId: string
	actorUserId: string | null
	actorName: string | null
	action: string
	entityType: string | null
	entityId: string | null
	metadata: Record<string, unknown>
	ipAddress: string | null
	createdAt: string
}

export interface MenuProductLite {
	id: string
	name: string
	sku: string
	price: number
	status: string
}

export interface MenuModifier {
	id: string
	name: string
	priceAdjustment: number
	available: boolean
	status: string
}

export interface MenuModifierGroup {
	id: string
	name: string
	required: boolean
	minSelections: number
	maxSelections: number
	sortOrder: number
	status: string
	modifiers: MenuModifier[]
}

export interface MenuItem {
	id: string
	available: boolean
	preparationTimeMin: number
	kitchenStation: string | null
	dietaryTags: string[]
	allergens: string[]
	taxRate: number
	sortOrder: number
	status: 'active' | 'inactive' | 'archived'
	availability: { days: number[]; start: string; end: string }[]
	product: {
		id: string
		name: string
		sku: string
		price: number
		image?: string | null
	}
	modifierGroups?: MenuModifierGroup[]
}

export interface FoodOrderModifierSnapshot {
	modifierId: string
	groupName: string
	name: string
	priceAdjustment: number
	quantity: number
}

export interface FoodOrderLine {
	id: string
	menuItemId: string | null
	name: string
	modifiers: FoodOrderModifierSnapshot[]
	unitPrice: number
	quantity: number
	total: number
}

export interface FoodOrder {
	id: string
	orderNumber: string
	status: 'CREATED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'
	paymentStatus: string
	orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'QR' | 'POS' | 'SCHEDULED'
	outletId: string | null
	outletName: string | null
	scheduledFor: string | null
	subtotal: number
	taxTotal: number
	total: number
	currency: string
	notes: string | null
	createdAt: string
	items: FoodOrderLine[]
}

// ---- dine-in tables + QR ----

export interface TableSection {
	id: string
	name: string
	sortOrder: number
	status: 'active' | 'inactive'
	outletId: string
	outletName: string | null
}

export type TableState = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'ORDERING' | 'DINING' | 'BILL_REQUESTED' | 'PAYMENT_PENDING' | 'CLEANING'

export interface OpenSession {
	id: string
	guests: number
	openedAt: string
	notes: string | null
}

export interface DiningTable {
	id: string
	name: string
	code: string
	seats: number
	status: TableState
	outletId: string
	sectionId: string | null
	sectionName: string | null
	qrToken: string
	createdAt: string
	openSession: OpenSession | null
	orderCount: number
	total: number
}

export interface TableSession {
	id: string
	status: 'OPEN' | 'CLOSED' | 'CANCELLED'
	guests: number
	tableId: string | null
	tableName: string | null
	tableCode: string | null
	sectionName: string | null
	outletId: string | null
	notes: string | null
	openedAt: string
	closedAt: string | null
	orderCount: number
	total: number
	orders: Array<{ orderNumber: string; total: number; status: string }>
}

export interface TableQrContextItem {
	id: string
	name: string
	description: string | null
	price: number
	taxRate: number
}

// ---- kitchen / KOT / KDS ----

export type KitchenStationStatus = 'active' | 'inactive' | 'archived'
export type KotStatus = 'NEW' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'RECALLED' | 'CANCELLED'
export type KitchenItemStatus = 'PENDING' | 'READY' | 'DONE' | 'CANCELLED'
export type KitchenPriority = 'LOW' | 'NORMAL' | 'HIGH'

export interface KitchenStation {
	id: string
	name: string
	prepSlaMin: number
	sortOrder: number
	status: KitchenStationStatus
	outletId: string
	outletName: string | null
	openTickets: number
}

export interface KotItem {
	name: string
	quantity: number
	modifiers: { groupName: string; name: string; quantity: number }[]
	status: KitchenItemStatus
}

export interface KitchenTicket {
	id: string
	orderNumber: string
	orderType: string
	sourceType: string | null
	stationId: string
	stationName: string
	status: KotStatus
	priority: KitchenPriority
	prepSlaMin: number | null
	receivedAt: string
	startedAt: string | null
	dueAt: string | null
	readyAt: string | null
	closedAt: string | null
	ageSec: number
	delayed: boolean
	items: KotItem[]
}

export interface KdsBoard {
	stations: Array<{
		id: string
		name: string
		prepSlaMin: number
		tickets: KdsTicket[]
	}>
	delayedCount: number
}

export interface KdsTicket {
	id: string
	orderNumber: string
	stationId: string
	stationName: string
	sourceType: string | null
	status: KotStatus
	priority: KitchenPriority
	prepSlaMin: number | null
	receivedAt: string
	startedAt: string | null
	dueAt: string | null
	readyAt: string | null
	tableName: string | null
	ageSec: number
	delayed: boolean
	items: KdsItem[]
}

export interface KdsItem {
	id: string
	name: string
	modifiers: { groupName: string; name: string; quantity: number }[]
	quantity: number
	status: KitchenItemStatus
	readyAt: string | null
}

// ------------------------------ delivery ------------------------------

export type DeliveryZoneStatus = 'active' | 'inactive'
export type DeliveryStatus =
	| 'UNASSIGNED'
	| 'ASSIGNED'
	| 'ARRIVED_AT_PICKUP'
	| 'PICKED_UP'
	| 'IN_TRANSIT'
	| 'ARRIVED'
	| 'DELIVERED'
	| 'FAILED'
	| 'CANCELLED'
export type DriverStatus = 'OFFLINE' | 'ONLINE' | 'BUSY' | 'PAUSED' | 'SUSPENDED'

export interface DeliveryAddress {
	name?: string
	line1?: string
	line2?: string
	city?: string
	state?: string
	postalCode?: string
	country?: string
	phone?: string
}

export interface DeliveryZone {
	id: string
	merchantId: string
	outletId: string | null
	name: string
	centerLat: number
	centerLng: number
	radiusKm: number
	deliveryFee: number
	minOrder: number
	freeDeliveryThreshold: number | null
	etaMin: number
	status: DeliveryZoneStatus
	createdAt: string
	updatedAt: string
}

export interface Driver {
	id: string
	userId: string
	name: string
	phone: string | null
	email: string | null
	vehicleType: string | null
	vehiclePlate: string | null
	status: DriverStatus
	assignedOutletId: string | null
	outletName?: string | null
	createdAt: string
	updatedAt: string
}

export interface DeliveryOrder {
	id: string
	orderId: string
	orderNumber: string
	outletId: string | null
	outletName: string | null
	zoneId: string | null
	status: DeliveryStatus
	assignedDriverId: string | null
	driverName: string | null
	address: DeliveryAddress
	fee: number
	etaMin: number
	pickupAt: string | null
	pickedUpAt: string | null
	arrivedAt: string | null
	deliveredAt: string | null
	cancelledAt: string | null
	notes: string | null
	createdAt: string
	updatedAt: string
}

