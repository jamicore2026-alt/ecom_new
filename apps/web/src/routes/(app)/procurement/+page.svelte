<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { currency, dateTime } from '$lib/format'

	type Tab = 'suppliers' | 'purchase-orders' | 'receipts'

	interface AddressPart {
		name?: string
		line1?: string
		line2?: string
		city?: string
		state?: string
		postalCode?: string
		country?: string
		phone?: string
	}

	interface Supplier {
		id: string
		merchantId: string
		name: string
		contactName: string | null
		email: string | null
		phone: string | null
		address: AddressPart
		taxId: string | null
		status: string
		notes: string | null
		createdAt: string
		updatedAt: string
	}

	interface POListItem {
		id: string
		poNumber: string
		supplierId: string
		status: string
		subtotal: number
		expectedAt: string | null
		approvedAt: string | null
		createdAt: string
		supplierName: string
		itemCount: number
		orderedQty: number
		receivedQty: number
	}

	interface POItemLine {
		id: string
		variantId: string
		quantity: number
		unitCost: number
		receivedQuantity: number
		sku: string | null
		optionValues: Record<string, string>
		productId: string
		productName: string
	}

	interface ReceiptRef {
		id: string
		receiptNumber: string
		purchaseOrderId: string
		warehouseId: string
		notes: string | null
		createdAt: string
		warehouseName: string
	}

	interface PODetail {
		id: string
		poNumber: string
		supplierId: string
		status: string
		expectedAt: string | null
		notes: string | null
		subtotal: number
		approvedAt: string | null
		createdAt: string
		supplier: Supplier
		items: POItemLine[]
		receipts: ReceiptRef[]
	}

	interface ProductOption {
		id: string
		name: string
		sku: string | null
		price: number
	}

	interface ProductVariantOption {
		id: string
		productId: string
		optionValues: Record<string, string>
		sku: string | null
		price: number
	}

	interface POCreateItem {
		productId: string | null
		productName: string
		variantId: string | null
		variantLabel: string
		search: string
		quantity: number
		unitCost: number
	}

	interface Warehouse {
		id: string
		name: string
	}

	interface ReceiveLine {
		purchaseOrderItemId: string
		productName: string
		sku: string | null
		optionLabel: string
		quantity: number
		outstanding: number
		unitCost: number
	}

	interface GRListItem {
		id: string
		receiptNumber: string
		purchaseOrderId: string
		warehouseId: string
		notes: string | null
		createdAt: string
		poNumber: string
		warehouseName: string
		itemCount: number
		totalQty: number
	}

	interface GRItem {
		id: string
		purchaseOrderItemId: string
		variantId: string
		quantity: number
		unitCost: number
		sku: string | null
		optionValues: Record<string, string>
		productId: string
		productName: string
	}

	interface GRDetail {
		id: string
		receiptNumber: string
		purchaseOrderId: string
		warehouseId: string
		notes: string | null
		createdAt: string
		items: GRItem[]
	}

	const TAB_DEFS: Array<{ id: Tab; label: string }> = [
		{ id: 'suppliers', label: 'Suppliers' },
		{ id: 'purchase-orders', label: 'Purchase Orders' },
		{ id: 'receipts', label: 'Goods Receipts' }
	]

	const canManage = () => session.can('inventory.manage')

	let tab = $state<Tab>('suppliers')

	let suppliers = $state<Supplier[]>([])
	let suppliersLoading = $state(true)
	let suppliersLoaded = $state(false)

	let purchaseOrders = $state<POListItem[]>([])
	let posLoading = $state(true)
	let posLoaded = $state(false)

	let receipts = $state<GRListItem[]>([])
	let receiptsLoading = $state(true)
	let receiptsLoaded = $state(false)

	async function loadSuppliers() {
		suppliersLoading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Supplier[] } }>('/api/suppliers', { limit: 100 })
			suppliers = res.data.items
			suppliersLoaded = true
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			suppliersLoading = false
		}
	}

	async function loadPurchaseOrders() {
		posLoading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: POListItem[] } }>('/api/purchase-orders', { limit: 100 })
			purchaseOrders = res.data.items
			posLoaded = true
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			posLoading = false
		}
	}

	async function loadReceipts() {
		receiptsLoading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: GRListItem[] } }>('/api/goods-receipts', { limit: 100 })
			receipts = res.data.items
			receiptsLoaded = true
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			receiptsLoading = false
		}
	}

	function switchTab(t: Tab) {
		tab = t
		if (t === 'suppliers' && !suppliersLoaded) loadSuppliers()
		else if (t === 'purchase-orders' && !posLoaded) loadPurchaseOrders()
		else if (t === 'receipts' && !receiptsLoaded) loadReceipts()
	}

	onMount(() => {
		loadSuppliers()
		loadPurchaseOrders()
		loadReceipts()
	})

	/* ------------------------------- suppliers ------------------------------- */

	let supplierModalOpen = $state(false)
	let editingSupplier = $state<Supplier | null>(null)
	let sName = $state('')
	let sContact = $state('')
	let sEmail = $state('')
	let sPhone = $state('')
	let sAddress = $state<AddressPart>({})
	let sSaving = $state(false)

	function openNewSupplier() {
		editingSupplier = null
		sName = ''
		sContact = ''
		sEmail = ''
		sPhone = ''
		sAddress = {}
		supplierModalOpen = true
	}

	function openEditSupplier(s: Supplier) {
		editingSupplier = s
		sName = s.name
		sContact = s.contactName ?? ''
		sEmail = s.email ?? ''
		sPhone = s.phone ?? ''
		sAddress = { ...(s.address ?? {}) }
		supplierModalOpen = true
	}

	async function saveSupplier() {
		if (!sName.trim()) return toast.error('Supplier name is required')
		sSaving = true
		try {
			const address = Object.fromEntries(
				Object.entries(sAddress).filter(([, v]) => v && String(v).trim().length)
			)
			const body = {
				name: sName.trim(),
				...(sContact.trim() ? { contactName: sContact.trim() } : {}),
				...(sEmail.trim() ? { email: sEmail.trim() } : {}),
				...(sPhone.trim() ? { phone: sPhone.trim() } : {}),
				...(Object.keys(address).length ? { address } : {})
			}
			if (editingSupplier) {
				await api.put<{ success: boolean }>(`/api/suppliers/${editingSupplier.id}`, body)
				toast.success('Supplier updated')
			} else {
				await api.post<{ success: boolean }>('/api/suppliers', body)
				toast.success('Supplier created')
			}
			supplierModalOpen = false
			await loadSuppliers()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			sSaving = false
		}
	}

	/* ----------------------------- purchase orders ---------------------------- */

	let productOptions = $state<ProductOption[]>([])
	let productOptionsLoading = $state(false)

	let poModalOpen = $state(false)
	let editingPo = $state<POListItem | null>(null)
	let poSupplierId = $state('')
	let poExpectedAt = $state('')
	let poNotes = $state('')
	let poItems = $state<POCreateItem[]>([])
	let poSaving = $state(false)
	let poBusy = $state('')

	let searchFocusIndex = $state<number | null>(null)

	const poSubtotal = $derived(
		poItems
			.filter((r) => r.productId)
			.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitCost) || 0), 0)
	)

	async function ensureProducts() {
		if (productOptions.length || productOptionsLoading) return
		productOptionsLoading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: ProductOption[] } }>('/api/products', {
				page: 1,
				limit: 50
			})
			productOptions = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			productOptionsLoading = false
		}
	}

	function newEmptyRow(): POCreateItem {
		return { productId: null, productName: '', variantId: null, variantLabel: '', search: '', quantity: 1, unitCost: 0 }
	}

	function optionLabel(v: Record<string, string>) {
		const entries = Object.entries(v ?? {})
		return entries.length ? entries.map(([k, val]) => `${k}: ${val}`).join(', ') : ''
	}

	function filteredProducts(row: POCreateItem) {
		const q = row.search.trim().toLowerCase()
		const base = productOptions.slice(0, 50)
		if (!q) return base.slice(0, 8)
		return base
			.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
			.slice(0, 8)
	}

	async function pickProduct(row: POCreateItem, p: ProductOption) {
		row.productId = p.id
		row.productName = p.name
		row.search = p.name
		row.variantId = null
		row.variantLabel = ''
		row.unitCost = Number(p.price) || 0
		searchFocusIndex = null
		try {
			const res = await api.get<{ success: boolean; data: { variants: ProductVariantOption[] } }>(`/api/products/${p.id}`)
			const variants = res.data.variants ?? []
			const v = variants.find((x) => Object.keys(x.optionValues ?? {}).length === 0) ?? variants[0]
			row.variantId = v?.id ?? null
			row.variantLabel = v ? optionLabel(v.optionValues) : ''
			if (v && Number(v.price) > 0) row.unitCost = Number(v.price)
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function openNewPo() {
		editingPo = null
		poSupplierId = ''
		poExpectedAt = ''
		poNotes = ''
		poItems = [newEmptyRow()]
		searchFocusIndex = null
		ensureProducts()
		poModalOpen = true
	}

	async function openEditPo(po: POListItem) {
		ensureProducts()
		poModalOpen = true
		try {
			const res = await api.get<{ success: boolean; data: PODetail }>(`/api/purchase-orders/${po.id}`)
			const d = res.data
			editingPo = po
			poSupplierId = d.supplierId
			poExpectedAt = d.expectedAt ? d.expectedAt.slice(0, 10) : ''
			poNotes = d.notes ?? ''
			poItems = d.items.map((it) => ({
				productId: it.productId,
				productName: it.productName,
				variantId: it.variantId,
				variantLabel: optionLabel(it.optionValues),
				search: it.productName,
				quantity: it.quantity,
				unitCost: Number(it.unitCost)
			}))
		} catch (e) {
			toast.error((e as Error).message)
			poModalOpen = false
		}
	}

	async function savePo() {
		if (!poSupplierId) return toast.error('Select a supplier')
		const items = poItems.filter((r) => r.productId)
		if (!items.length) return toast.error('Add at least one product')
		for (const r of items) {
			if (!r.variantId) return toast.error('Select a product and wait for its variant to load')
			if (!Number.isInteger(Number(r.quantity)) || Number(r.quantity) < 1)
				return toast.error('Quantity must be a positive whole number')
			if (Number.isNaN(Number(r.unitCost)) || Number(r.unitCost) < 0)
				return toast.error('Unit cost must be a non-negative number')
		}
		poSaving = true
		try {
			const body = {
				supplierId: poSupplierId,
				...(poExpectedAt ? { expectedAt: poExpectedAt } : {}),
				...(poNotes.trim() ? { notes: poNotes.trim() } : {}),
				items: items.map((r) => ({
					variantId: r.variantId as string,
					quantity: Number(r.quantity),
					unitCost: Number(r.unitCost)
				}))
			}
			if (editingPo) {
				await api.put<{ success: boolean }>(`/api/purchase-orders/${editingPo.id}`, body)
				toast.success('Purchase order updated')
			} else {
				await api.post<{ success: boolean }>('/api/purchase-orders', body)
				toast.success('Purchase order created')
			}
			poModalOpen = false
			await loadPurchaseOrders()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			poSaving = false
		}
	}

	async function poWorkflow(po: POListItem, action: 'submit' | 'approve' | 'cancel' | 'receive') {
		const label = action === 'submit' ? 'Submit' : action === 'approve' ? 'Approve' : action === 'cancel' ? 'Cancel' : 'Receive'
		if (action === 'cancel' && !confirm(`Cancel purchase order ${po.poNumber}?`)) return
		poBusy = `${po.id}:${action}`
		try {
			await api.post<{ success: boolean }>(`/api/purchase-orders/${po.id}/${action}`)
			toast.success(`Purchase order ${label.toLowerCase()}d`)
			await loadPurchaseOrders()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			poBusy = ''
		}
	}

	/* ------------------------------- PO detail ------------------------------- */

	let detailPo = $state<PODetail | null>(null)
	let detailLoading = $state(false)

	async function openPoDetail(po: POListItem) {
		detailPo = null
		detailLoading = true
		try {
			const res = await api.get<{ success: boolean; data: PODetail }>(`/api/purchase-orders/${po.id}`)
			detailPo = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			detailLoading = false
		}
	}

	/* --------------------------------- receive -------------------------------- */

	let receiveOpen = $state(false)
	let receivePo = $state<POListItem | null>(null)
	let receiveLines = $state<ReceiveLine[]>([])
	let receiveWarehouseId = $state('')
	let receiveNotes = $state('')
	let receiveLoading = $state(false)
	let receiving = $state(false)
	let warehouses = $state<Warehouse[]>([])

	const validReceive = $derived(
		receiveOpen &&
			receiveWarehouseId !== '' &&
			receiveLines.length > 0 &&
			receiveLines.every(
				(l) => Number(l.quantity) > 0 && Number(l.quantity) <= l.outstanding && Number.isInteger(Number(l.quantity))
			)
	)

	async function openReceive(po: POListItem) {
		receivePo = po
		receiveWarehouseId = ''
		receiveNotes = ''
		receiveLines = []
		receiveOpen = true
		receiveLoading = true
		try {
			const [whRes, poRes] = await Promise.all([
				api.get<{ success: boolean; data: { items: Warehouse[] } }>('/api/warehouses', { limit: 100 }),
				api.get<{ success: boolean; data: PODetail }>(`/api/purchase-orders/${po.id}`)
			])
			warehouses = whRes.data.items
			if (!warehouses.some((w) => w.id === receiveWarehouseId)) {
				receiveWarehouseId = warehouses[0]?.id ?? ''
			}
			receiveLines = poRes.data.items.map((it) => ({
				purchaseOrderItemId: it.id,
				productName: it.productName,
				sku: it.sku,
				optionLabel: optionLabel(it.optionValues),
				quantity: it.quantity - it.receivedQuantity,
				outstanding: it.quantity - it.receivedQuantity,
				unitCost: Number(it.unitCost)
			}))
		} catch (e) {
			toast.error((e as Error).message)
			receiveOpen = false
		} finally {
			receiveLoading = false
		}
	}

	async function saveReceive() {
		if (!receivePo) return
		if (!receiveWarehouseId) return toast.error('Select a warehouse')
		const lines = receiveLines.filter((l) => Number(l.quantity) > 0)
		if (!lines.length) return toast.error('Enter a quantity for at least one item')
		receiving = true
		try {
			const res = await api.post<{
				success: boolean
				data: { receiptId: string; receiptNumber: string; status: string }
			}>(`/api/purchase-orders/${receivePo.id}/receive`, {
				warehouseId: receiveWarehouseId,
				...(receiveNotes.trim() ? { notes: receiveNotes.trim() } : {}),
				items: lines.map((l) => ({ purchaseOrderItemId: l.purchaseOrderItemId, quantity: Number(l.quantity) }))
			})
			toast.success(`Receipt ${res.data.receiptNumber} created`)
			receiveOpen = false
			await Promise.all([loadPurchaseOrders(), loadReceipts()])
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			receiving = false
		}
	}

	/* ---------------------------- receipts detail ----------------------------- */

	let detailGr = $state<GRDetail | null>(null)

	async function openGrDetail(gr: GRListItem) {
		detailGr = null
		try {
			const res = await api.get<{ success: boolean; data: GRDetail }>(`/api/goods-receipts/${gr.id}`)
			detailGr = res.data
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	const skel = () =>
		Array.from({ length: 6 }, (_, i) => ({ id: i }))

	const dataOrDash = (s: string | null | undefined) => (s ? dateTime(s) : '—')

	const busy = (po: POListItem, action: string) => poBusy === `${po.id}:${action}`
</script>

<svelte:head>
	<title>Procurement — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Procurement</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage suppliers, purchase orders, and goods receipts.</p>
		</div>
	</div>

	<div class="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
		{#each TAB_DEFS as tDef (tDef.id)}
			<button
				class="rounded-md px-3 py-1.5 text-sm font-medium max-sm:min-h-11 max-sm:inline-flex max-sm:items-center transition-colors {tab === tDef.id ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}"
				onclick={() => switchTab(tDef.id)}
			>
				{tDef.label}
			</button>
		{/each}
	</div>

	{#if tab === 'suppliers'}
		<Card padded={false}>
			<div class="flex items-center justify-between border-b border-outline-variant px-5 py-4">
				<h2 class="text-sm font-semibold text-on-surface">Suppliers</h2>
				{#if canManage()}
					<Button size="sm" onclick={openNewSupplier}><Icon name="add" size="text-[16px]" /> New supplier</Button>
				{/if}
			</div>
			{#if suppliersLoading}
				<div class="space-y-2 p-5">
					{#each skel() as s (s.id)}
						<div class="h-12 animate-pulse rounded bg-surface-container"></div>
					{/each}
				</div>
			{:else if suppliers.length === 0}
				<div class="flex flex-col items-center gap-2 py-14 text-center">
					<Icon name="group_add" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No suppliers yet.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">Name</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Contact</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Location</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each suppliers as s (s.id)}
								<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
									<td class="px-table-cell-x py-table-cell-y">
										<p class="font-medium text-on-surface">{s.name}</p>
										{#if s.contactName}
											<p class="text-xs text-secondary">{s.contactName}</p>
										{/if}
									</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">
										{#if s.phone}<p>{s.phone}</p>{/if}
										{#if s.email}<p class="text-xs text-secondary">{s.email}</p>{/if}
										{#if !s.phone && !s.email}<span class="text-outline">—</span>{/if}
									</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">
										<span class="line-clamp-1">{[s.address.city, s.address.state, s.address.country].filter(Boolean).join(', ') || '—'}</span>
									</td>
									<td class="px-table-cell-x py-table-cell-y"><Badge label={s.status} /></td>
									<td class="px-table-cell-x py-table-cell-y text-right whitespace-nowrap">
										{#if canManage()}
											<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEditSupplier(s)}>Edit</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	{:else if tab === 'purchase-orders'}
		<Card padded={false}>
			<div class="flex items-center justify-between border-b border-outline-variant px-5 py-4">
				<h2 class="text-sm font-semibold text-on-surface">Purchase orders</h2>
				{#if canManage()}
					<Button size="sm" onclick={openNewPo}><Icon name="add" size="text-[16px]" /> New purchase order</Button>
				{/if}
			</div>
			{#if posLoading}
				<div class="space-y-2 p-5">
					{#each skel() as s (s.id)}
						<div class="h-12 animate-pulse rounded bg-surface-container"></div>
					{/each}
				</div>
			{:else if purchaseOrders.length === 0}
				<div class="flex flex-col items-center gap-2 py-14 text-center">
					<Icon name="receipt_long" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No purchase orders yet.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">Number</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Supplier</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Total</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Expected</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each purchaseOrders as po (po.id)}
								<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
									<td class="px-table-cell-x py-table-cell-y">
										<p class="font-mono-label text-mono-label font-medium text-on-surface">{po.poNumber}</p>
										<p class="text-xs text-secondary">{dateTime(po.createdAt)}</p>
									</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{po.supplierName}</td>
									<td class="px-table-cell-x py-table-cell-y"><Badge label={po.status} /></td>
									<td class="px-table-cell-x py-table-cell-y text-right font-mono-label text-mono-label text-on-surface">{currency(po.subtotal)}</td>
									<td class="px-table-cell-x py-table-cell-y text-secondary">{dataOrDash(po.expectedAt)}</td>
									<td class="px-table-cell-x py-table-cell-y text-right whitespace-nowrap">
										{#if canManage()}
											{#if po.status === 'draft'}
												<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy(po, 'submit') || poBusy !== ''} onclick={() => poWorkflow(po, 'submit')}>
													{#if busy(po, 'submit')}<Icon name="progress_activity" size="text-[14px]" class="inline animate-spin" />{:else}Submit{/if}
												</button>
												<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => openEditPo(po)}>Edit</button>
												<button class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => poWorkflow(po, 'cancel')}>Cancel</button>
											{:else if po.status === 'pending'}
												<button class="rounded p-1.5 text-xs font-medium text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy(po, 'approve') || poBusy !== ''} onclick={() => poWorkflow(po, 'approve')}>
													{#if busy(po, 'approve')}<Icon name="progress_activity" size="text-[14px]" class="inline animate-spin" />{:else}Approve{/if}
												</button>
												<button class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => poWorkflow(po, 'cancel')}>Cancel</button>
											{:else if po.status === 'approved' || po.status === 'partial'}
												<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openReceive(po)}>Receive</button>
												<button class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => poWorkflow(po, 'cancel')}>Cancel</button>
											{/if}
										{/if}
										<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => openPoDetail(po)}>Details</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	{:else}
		<Card padded={false}>
			<div class="flex items-center justify-between border-b border-outline-variant px-5 py-4">
				<h2 class="text-sm font-semibold text-on-surface">Goods receipts</h2>
			</div>
			{#if receiptsLoading}
				<div class="space-y-2 p-5">
					{#each skel() as s (s.id)}
						<div class="h-12 animate-pulse rounded bg-surface-container"></div>
					{/each}
				</div>
			{:else if receipts.length === 0}
				<div class="flex flex-col items-center gap-2 py-14 text-center">
					<Icon name="inventory_2" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No goods receipts yet. Receive an approved purchase order to create one.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">Receipt</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Purchase order</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Warehouse</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Date</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Items</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Qty</th>
							</tr>
						</thead>
						<tbody>
							{#each receipts as gr (gr.id)}
								<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
									<td class="px-table-cell-x py-table-cell-y">
										<button class="rounded p-1 font-mono-label text-mono-label font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openGrDetail(gr)}>{gr.receiptNumber}</button>
									</td>
									<td class="px-table-cell-x py-table-cell-y font-mono text-xs text-on-surface-variant">{gr.poNumber}</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{gr.warehouseName}</td>
									<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(gr.createdAt)}</td>
									<td class="px-table-cell-x py-table-cell-y text-right font-medium text-on-surface">{gr.itemCount}</td>
									<td class="px-table-cell-x py-table-cell-y text-right font-medium text-on-surface">{gr.totalQty}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	{/if}
</div>

{#if supplierModalOpen && canManage()}
	<Modal title={editingSupplier ? `Edit ${editingSupplier.name}` : 'New supplier'} open={true} width="md" onClose={() => (supplierModalOpen = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveSupplier() }}>
			<div>
				<label for="sup-name" class="field-label">Name *</label>
				<input id="sup-name" class="field" bind:value={sName} required />
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label for="sup-contact" class="field-label">Contact name</label>
					<input id="sup-contact" class="field" bind:value={sContact} />
				</div>
				<div>
					<label for="sup-phone" class="field-label">Phone</label>
					<input id="sup-phone" class="field" bind:value={sPhone} />
				</div>
				<div class="sm:col-span-2">
					<label for="sup-email" class="field-label">Email</label>
					<input id="sup-email" class="field" type="email" bind:value={sEmail} />
				</div>
			</div>
			<div>
				<p class="field-label mb-2">Address</p>
				<div class="grid gap-3 sm:grid-cols-2">
					<input class="field" placeholder="Line 1" bind:value={sAddress.line1} />
					<input class="field" placeholder="Line 2" bind:value={sAddress.line2} />
					<input class="field" placeholder="City" bind:value={sAddress.city} />
					<input class="field" placeholder="State" bind:value={sAddress.state} />
					<input class="field" placeholder="Postal code" bind:value={sAddress.postalCode} />
					<input class="field" placeholder="Country" bind:value={sAddress.country} />
				</div>
			</div>
			{#if editingSupplier}
				<div>
					<label for="sup-status" class="field-label">Status</label>
					<select id="sup-status" class="field" bind:value={editingSupplier.status}>
						<option value="active">Active</option>
						<option value="inactive">Inactive</option>
					</select>
				</div>
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (supplierModalOpen = false)}>Cancel</Button>
				<Button type="submit" loading={sSaving}>{editingSupplier ? 'Save' : 'Create supplier'}</Button>
			</div>
		</form>
	</Modal>
{/if}

{#if poModalOpen && canManage()}
	<Modal title={editingPo ? `Edit ${editingPo.poNumber}` : 'New purchase order'} open={true} width="xl" onClose={() => (poModalOpen = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); savePo() }}>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label for="po-supplier" class="field-label">Supplier *</label>
					<select id="po-supplier" class="field" bind:value={poSupplierId} required>
						<option value="">Select supplier</option>
						{#each suppliers as s (s.id)}
							<option value={s.id}>{s.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<label for="po-expected" class="field-label">Expected delivery date</label>
					<input id="po-expected" class="field" type="date" bind:value={poExpectedAt} />
				</div>
			</div>

			<div>
				<div class="mb-2 flex items-center justify-between">
					<p class="field-label">Items</p>
					<button type="button" class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => (poItems = [...poItems, newEmptyRow()])}>
						+ Add item
					</button>
				</div>
				{#if productOptionsLoading}
					<p class="py-3 text-center text-sm text-secondary">Loading products…</p>
				{:else}
					<div class="space-y-3">
						{#each poItems as row, i (i)}
							<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
								<div class="grid gap-2 md:grid-cols-[1fr_110px_130px_90px_32px] md:items-center">
									{#if row.productId}
										<div class="flex min-w-0 items-center gap-2">
											<span class="truncate text-sm font-medium text-on-surface">{row.productName}</span>
											{#if row.variantLabel}
												<span class="truncate text-xs text-secondary">{row.variantLabel}</span>
											{/if}
											{#if !row.variantId}
												<span class="text-xs text-warning">Loading variant…</span>
											{/if}
											<button type="button" class="shrink-0 rounded p-1 text-sm text-outline hover:bg-surface-container hover:text-on-surface" onclick={() => { row.productId = null; row.productName = ''; row.search = ''; row.variantId = null; row.variantLabel = '' }} aria-label="Change product">Change</button>
										</div>
									{:else}
										<div class="relative">
											<input
												class="field w-full"
												placeholder="Search products…"
												bind:value={row.search}
												onfocus={() => (searchFocusIndex = i)}
												onblur={() => setTimeout(() => { if (searchFocusIndex === i) searchFocusIndex = null }, 150)}
											/>
											{#if searchFocusIndex === i}
												<div class="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-outline-variant bg-surface-container-lowest shadow-xl">
													{#each filteredProducts(row) as p (p.id)}
														<button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-container" onclick={() => pickProduct(row, p)}>
															<span class="min-w-0 truncate">{p.name}</span>
															{#if p.sku}
																<span class="shrink-0 text-xs text-secondary">{p.sku}</span>
															{/if}
														</button>
													{/each}
													{#if filteredProducts(row).length === 0}
														<p class="px-3 py-2 text-xs text-secondary">No matching products.</p>
													{/if}
												</div>
											{/if}
										</div>
									{/if}
									<div>
										<input class="field w-full" type="number" min="1" step="1" placeholder="Qty" bind:value={row.quantity} />
									</div>
									<div>
										<input class="field w-full" type="number" min="0" step="0.01" placeholder="Unit cost" bind:value={row.unitCost} />
									</div>
									<div class="text-right font-mono-label text-mono-label text-on-surface md:text-left">
										{currency((Number(row.quantity) || 0) * (Number(row.unitCost) || 0))}
									</div>
									<button type="button" class="rounded p-1.5 text-sm text-outline hover:bg-error-container/40 hover:text-error" onclick={() => (poItems = poItems.filter((_, j) => j !== i))} aria-label="Remove item">×</button>
								</div>
							</div>
						{/each}
						{#if poItems.length === 0}
							<p class="py-4 text-center text-sm text-secondary">No items yet. Add at least one product.</p>
						{/if}
					</div>
				{/if}
			</div>

			<div>
				<label for="po-notes" class="field-label">Notes</label>
				<textarea id="po-notes" class="field h-24 w-full" bind:value={poNotes} placeholder="Optional notes for this purchase order"></textarea>
			</div>

			<div class="flex items-center justify-between pt-2">
				<p class="text-sm text-secondary">Subtotal <span class="font-mono-label text-mono-label text-on-surface">{currency(poSubtotal)}</span></p>
				<div class="flex gap-2">
					<Button variant="secondary" onclick={() => (poModalOpen = false)}>Cancel</Button>
					<Button type="submit" loading={poSaving}>{editingPo ? 'Save changes' : 'Create purchase order'}</Button>
				</div>
			</div>
		</form>
	</Modal>
{/if}

{#if detailPo}
	<Modal title={detailPo.poNumber} open={true} width="xl" onClose={() => (detailPo = null)}>
		{#if detailLoading}
			<div class="space-y-2">
				{#each skel() as s (s.id)}
					<div class="h-10 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else}
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div class="flex items-center gap-2">
						<h3 class="text-base font-semibold text-on-surface">{detailPo.poNumber}</h3>
						<Badge label={detailPo.status} />
					</div>
					<p class="mt-0.5 text-sm text-secondary">{detailPo.supplier.name}</p>
					<p class="mt-0.5 text-xs text-secondary">
						Created {dateTime(detailPo.createdAt)}{detailPo.expectedAt ? ` · Expected ${dateTime(detailPo.expectedAt)}` : ''}{detailPo.approvedAt ? ` · Approved ${dateTime(detailPo.approvedAt)}` : ''}
					</p>
				</div>
				<p class="font-mono-label text-mono-label text-xl text-on-surface">{currency(detailPo.subtotal)}</p>
			</div>
			{#if detailPo.notes}
				<p class="mt-3 rounded border border-outline-variant bg-surface-container-low p-3 text-sm text-secondary">{detailPo.notes}</p>
			{/if}

			<h4 class="mt-5 mb-2 text-sm font-semibold text-on-surface">Items</h4>
			<div class="overflow-x-auto rounded border border-outline-variant">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
						<tr>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Product</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">SKU</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Ordered</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Received</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Unit cost</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each detailPo.items as it (it.id)}
							<tr class="border-b border-outline-variant/60">
								<td class="px-table-cell-x py-table-cell-y">
									<p class="font-medium text-on-surface">{it.productName}</p>
									{#if optionLabel(it.optionValues)}
										<p class="text-xs text-secondary">{optionLabel(it.optionValues)}</p>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{it.sku ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-right font-medium text-on-surface">{it.quantity}</td>
								<td class="px-table-cell-x py-table-cell-y text-right text-secondary">{it.receivedQuantity}</td>
								<td class="px-table-cell-x py-table-cell-y text-right font-mono-label text-mono-label text-on-surface">{currency(it.unitCost)}</td>
								<td class="px-table-cell-x py-table-cell-y text-right font-mono-label text-mono-label text-on-surface">{currency(it.quantity * it.unitCost)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<h4 class="mt-5 mb-2 text-sm font-semibold text-on-surface">Receipts</h4>
			{#if detailPo.receipts.length === 0}
				<p class="py-4 text-center text-sm text-secondary">No goods received for this purchase order yet.</p>
			{:else}
				<div class="overflow-x-auto rounded border border-outline-variant">
					<table class="w-full text-left text-sm">
						<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<tr>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Receipt</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Warehouse</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Date</th>
							</tr>
						</thead>
						<tbody>
							{#each detailPo.receipts as r (r.id)}
								<tr class="border-b border-outline-variant/60">
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{r.receiptNumber}</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{r.warehouseName}</td>
									<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(r.createdAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</Modal>
{/if}

{#if receiveOpen && receivePo && canManage()}
	<Modal title={`Receive ${receivePo.poNumber}`} open={true} width="lg" onClose={() => (receiveOpen = false)}>
		{#if receiveLoading}
			<div class="space-y-2">
				{#each skel() as s (s.id)}
					<div class="h-10 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else}
			<div class="space-y-4">
				<div>
					<label for="recv-warehouse" class="field-label">Warehouse *</label>
					<select id="recv-warehouse" class="field" bind:value={receiveWarehouseId}>
						<option value="">Select warehouse</option>
						{#each warehouses as w (w.id)}
							<option value={w.id}>{w.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<p class="field-label mb-2">Quantities to receive</p>
					<div class="space-y-2">
						{#each receiveLines as line (line.purchaseOrderItemId)}
							<div class="grid grid-cols-[1fr_90px] items-center gap-2">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-on-surface">{line.productName}</p>
									<p class="text-xs text-secondary">
										{[line.sku, line.optionLabel].filter(Boolean).join(' · ') || '—'} · outstanding {line.outstanding}
									</p>
								</div>
								<input class="field" type="number" min="0" max={line.outstanding} step="1" bind:value={line.quantity} />
							</div>
						{/each}
					</div>
				</div>
				<div>
					<label for="recv-notes" class="field-label">Notes</label>
					<textarea id="recv-notes" class="field h-20 w-full" bind:value={receiveNotes}></textarea>
				</div>
				<div class="flex justify-end gap-2 pt-2">
					<Button variant="secondary" onclick={() => (receiveOpen = false)}>Cancel</Button>
					<Button loading={receiving} disabled={!validReceive} onclick={saveReceive}>Create receipt</Button>
				</div>
			</div>
		{/if}
	</Modal>
{/if}

{#if detailGr}
	<Modal title={detailGr.receiptNumber} open={true} width="lg" onClose={() => (detailGr = null)}>
		{#if !detailGr}
			<div class="space-y-2">
				{#each skel() as s (s.id)}
					<div class="h-10 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else}
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 class="text-base font-semibold text-on-surface">{detailGr.receiptNumber}</h3>
					<p class="mt-0.5 text-sm text-secondary">Received {dateTime(detailGr.createdAt)}</p>
				</div>
				<p class="font-mono-label text-mono-label text-xl text-on-surface">
					{currency(detailGr.items.reduce((sum, it) => sum + it.quantity * it.unitCost, 0))}
				</p>
			</div>
			{#if detailGr.notes}
				<p class="mt-3 rounded border border-outline-variant bg-surface-container-low p-3 text-sm text-secondary">{detailGr.notes}</p>
			{/if}
			<div class="mt-4 overflow-x-auto rounded border border-outline-variant">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
						<tr>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Product</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">SKU</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Qty</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Unit cost</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Total</th>
						</tr>
					</thead>
					<tbody>
						{#each detailGr.items as it (it.id)}
							<tr class="border-b border-outline-variant/60">
								<td class="px-table-cell-x py-table-cell-y">
									<p class="font-medium text-on-surface">{it.productName}</p>
									{#if optionLabel(it.optionValues)}
										<p class="text-xs text-secondary">{optionLabel(it.optionValues)}</p>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{it.sku ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-right font-medium text-on-surface">{it.quantity}</td>
								<td class="px-table-cell-x py-table-cell-y text-right font-mono-label text-mono-label text-on-surface">{currency(it.unitCost)}</td>
								<td class="px-table-cell-x py-table-cell-y text-right font-mono-label text-mono-label text-on-surface">{currency(it.quantity * it.unitCost)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Modal>
{/if}