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
	import Pagination from '$lib/components/Pagination.svelte'
	import { dateTime, number } from '$lib/format'
	import type { PaginationMeta } from '$lib/types'

	type Tab = 'boms' | 'production-orders'
	let tab = $state<Tab>('boms')

	interface BomListItem {
		id: string
		name: string
		outputVariantId: string
		outputQuantity: number
		status: string
		revision: number
		revisionOf: string | null
		scrapPercent: number
		yieldPercent: number
		notes: string | null
		createdAt: string
		productName: string
		sku: string | null
		optionValues: Record<string, string>
		componentCount: number
	}

	interface BomDetailItem {
		id: string
		variantId: string
		quantity: number
		productName: string
		sku: string | null
		optionValues: Record<string, string>
	}

	interface BomDetail {
		id: string
		merchantId: string
		name: string
		outputVariantId: string
		outputQuantity: number
		status: string
		revision: number
		revisionOf: string | null
		scrapPercent: number
		yieldPercent: number
		notes: string | null
		createdAt: string
		updatedAt: string
		output: { name: string; sku: string | null; optionValues: Record<string, string> }
		items: BomDetailItem[]
	}

	interface ProductionOrderListItem {
		id: string
		productionNumber: string
		bomId: string
		status: string
		quantity: number
		notes: string | null
		startedAt: string | null
		completedAt: string | null
		createdAt: string
		bomName: string
		productName: string
		sku: string | null
		optionValues: Record<string, string>
	}

	interface ProductionOrderDetail {
		id: string
		merchantId: string
		productionNumber: string
		bomId: string
		status: string
		quantity: number
		notes: string | null
		startedAt: string | null
		completedAt: string | null
		cancelledAt: string | null
		createdAt: string
		updatedAt: string
		bom: { name: string; outputQuantity: number; status: string }
		items: Array<{
			id: string
			variantId: string
			change: number
			beforeValue: number
			afterValue: number
			productName: string
			sku: string | null
			optionValues: Record<string, string>
		}>
	}

	interface PickerProduct {
		id: string
		name: string
		sku: string | null
		status: string
		variantCount: number
	}

	interface PickerVariant {
		id: string
		productId: string
		optionValues: Record<string, string>
		sku: string | null
		price: number
		inventory: number
	}

	interface CompRow {
		productId: string
		variantId: string
		quantity: string
	}

	const canManage = () => session.can('inventory.manage')

	// ---- shared picker ----
	let pickerProducts = $state<PickerProduct[]>([])
	let pickerMeta = $state<PaginationMeta>({ page: 1, limit: 50, total: 0, totalPages: 1 })
	let pickerPage = $state(1)
	let pickerSearch = $state('')
	let pickerLoading = $state(false)
	let variantsByProduct = $state<Record<string, PickerVariant[]>>({})
	let variantLoadingProduct = $state('')

	function optText(ov: Record<string, string> | null | undefined): string {
		const o = ov ?? {}
		return Object.keys(o).length ? Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(', ') : 'Default'
	}

	function variantLabel(v: PickerVariant): string {
		return v.sku ? `${optText(v.optionValues)} (${v.sku})` : optText(v.optionValues)
	}

	function productLabel(p: PickerProduct): string {
		return p.sku ? `${p.name} — ${p.sku}` : p.name
	}

	async function loadPickerProducts() {
		pickerLoading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: PickerProduct[]; meta: PaginationMeta } }>(
				'/api/products',
				{ page: pickerPage, limit: 50, ...(pickerSearch ? { search: pickerSearch } : {}) }
			)
			pickerMeta = res.data.meta
			for (const item of res.data.items) {
				if (!pickerProducts.some((p) => p.id === item.id)) pickerProducts = [...pickerProducts, item]
			}
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			pickerLoading = false
		}
	}

	function applyPicker() {
		pickerPage = 1
		loadPickerProducts()
	}

	function pickerPrev() {
		if (pickerMeta.page <= 1) return
		pickerPage = pickerPage - 1
		loadPickerProducts()
	}

	function pickerNext() {
		if (pickerMeta.page >= pickerMeta.totalPages) return
		pickerPage = pickerPage + 1
		loadPickerProducts()
	}

	async function loadVariants(productId: string) {
		if (!productId || variantsByProduct[productId] !== undefined) return
		variantLoadingProduct = productId
		try {
			const res = await api.get<{ success: boolean; data: PickerVariant[] }>(`/api/products/${productId}/variants`)
			variantsByProduct[productId] = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			variantLoadingProduct = ''
		}
	}

	async function ensureProduct(name: string): Promise<string> {
		const existing = pickerProducts.find((p) => p.name === name)
		if (existing) return existing.id
		try {
			const res = await api.get<{ success: boolean; data: { items: PickerProduct[] } }>('/api/products', {
				search: name,
				limit: 50
			})
			const match = res.data.items.find((p) => p.name === name)
			if (match) {
				if (!pickerProducts.some((p) => p.id === match.id)) pickerProducts = [...pickerProducts, match]
				return match.id
			}
		} catch (e) {
			toast.error((e as Error).message)
		}
		return ''
	}

	// ---- boms ----
	let boms = $state<BomListItem[]>([])
	let bomsMeta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let bomsLoading = $state(true)
	let bomsSearch = $state('')
	let bomsStatus = $state('')
	let bomsPage = $state(1)

	let bomModal = $state<'new' | 'edit' | null>(null)
	let bomDetail = $state<BomDetail | null>(null)
	let bomSaving = $state(false)
	let bomName = $state('')
	let bomOutputProductId = $state('')
	let bomOutputVariantId = $state('')
	let bomOutputQty = $state('1')
	let bomNotes = $state('')
	let bomStatus = $state('draft')
	let bomScrap = $state('0')
	let bomYield = $state('100')
	let bomRows = $state<CompRow[]>([])
	let revising = $state('')

	let bomDetailView = $state<BomDetail | null>(null)
	let bomDetailLoading = $state(false)

	async function loadBoms() {
		bomsLoading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: BomListItem[]; meta: PaginationMeta } }>(
				'/api/boms',
				{
					page: bomsPage,
					...(bomsSearch ? { search: bomsSearch } : {}),
					...(bomsStatus ? { status: bomsStatus } : {})
				}
			)
			boms = res.data.items
			bomsMeta = res.data.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			bomsLoading = false
		}
	}

	function applyBomFilters() {
		bomsPage = 1
		loadBoms()
	}

	function onBomsPage(p: number) {
		bomsPage = p
		loadBoms()
	}

	function resetBomForm() {
		bomName = ''
		bomOutputProductId = ''
		bomOutputVariantId = ''
		bomOutputQty = '1'
		bomNotes = ''
		bomStatus = 'draft'
		bomScrap = '0'
		bomYield = '100'
		bomRows = [{ productId: '', variantId: '', quantity: '1' }]
		pickerProducts = []
		pickerPage = 1
		pickerSearch = ''
	}

	function openNewBom() {
		resetBomForm()
		bomDetail = null
		bomModal = 'new'
		loadPickerProducts()
	}

	async function openEditBom(b: BomListItem) {
		resetBomForm()
		bomDetail = null
		bomModal = 'edit'
		await loadPickerProducts()
		try {
			const res = await api.get<{ success: boolean; data: BomDetail }>(`/api/boms/${b.id}`)
			bomDetail = res.data
			bomName = res.data.name
			bomStatus = res.data.status
			bomOutputQty = String(res.data.outputQuantity)
			bomScrap = String(res.data.scrapPercent ?? 0)
			bomYield = String(res.data.yieldPercent ?? 100)
			bomNotes = res.data.notes ?? ''
			bomOutputProductId = await ensureProduct(res.data.output.name)
			bomOutputVariantId = res.data.outputVariantId
			loadVariants(bomOutputProductId)
			const rows: CompRow[] = []
			for (const item of res.data.items) {
				const pid = await ensureProduct(item.productName)
				rows.push({ productId: pid, variantId: item.variantId, quantity: String(item.quantity) })
				loadVariants(pid)
			}
			bomRows = rows.length ? rows : [{ productId: '', variantId: '', quantity: '1' }]
		} catch (e) {
			toast.error((e as Error).message)
			bomModal = null
		}
	}

	function addBomRow() {
		bomRows = [...bomRows, { productId: '', variantId: '', quantity: '1' }]
	}

	function removeBomRow(i: number) {
		bomRows = bomRows.filter((_, j) => j !== i)
	}

	async function saveBom() {
		if (!bomName.trim()) {
			toast.error('BOM name is required')
			return
		}
		if (!bomOutputVariantId) {
			toast.error('Select an output product variant')
			return
		}
		const outputQty = Number(bomOutputQty)
		if (!Number.isInteger(outputQty) || outputQty < 1) {
			toast.error('Output quantity must be a positive integer')
			return
		}
		const validRows = bomRows.filter((r) => r.variantId && Number(r.quantity) >= 1)
		if (validRows.length === 0) {
			toast.error('Add at least one component')
			return
		}
		if (validRows.some((r) => r.variantId === bomOutputVariantId)) {
			toast.error('A BOM cannot consume its own output')
			return
		}
		const items = validRows.map((r) => ({ variantId: r.variantId, quantity: Number(r.quantity) }))
		const scrap = Number(bomScrap)
		const yieldPct = Number(bomYield)
		if (!(scrap >= 0 && scrap <= 100)) {
			toast.error('Scrap percent must be between 0 and 100')
			return
		}
		if (!(yieldPct > 0 && yieldPct <= 100)) {
			toast.error('Yield percent must be between 0 (exclusive) and 100')
			return
		}
		bomSaving = true
		try {
			if (bomModal === 'edit' && bomDetail) {
				const patch: Record<string, unknown> = { name: bomName.trim() }
				if (bomNotes.trim() !== (bomDetail.notes ?? '')) patch.notes = bomNotes.trim()
				if (bomStatus !== bomDetail.status) patch.status = bomStatus
				if (scrap !== Number(bomDetail.scrapPercent ?? 0)) patch.scrapPercent = scrap
				if (yieldPct !== Number(bomDetail.yieldPercent ?? 100)) patch.yieldPercent = yieldPct
				if (bomDetail.status === 'draft') patch.items = items
				await api.put<{ success: boolean }>(`/api/boms/${bomDetail.id}`, patch)
				toast.success('BOM updated')
			} else {
				await api.post<{ success: boolean }>('/api/boms', {
					name: bomName.trim(),
					outputVariantId: bomOutputVariantId,
					outputQuantity: outputQty,
					...(bomNotes.trim() ? { notes: bomNotes.trim() } : {}),
					scrapPercent: scrap,
					yieldPercent: yieldPct,
					items
				})
				toast.success('BOM created')
			}
			bomModal = null
			loadBoms()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			bomSaving = false
		}
	}

	async function setBomStatus(b: BomListItem, status: string) {
		try {
			await api.put<{ success: boolean }>(`/api/boms/${b.id}`, { status })
			toast.success(status === 'active' ? 'BOM activated' : 'BOM deactivated')
			loadBoms()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function reviseBom(b: BomListItem) {
		if (!confirm(`Create a new draft revision of "${b.name}" (rev ${(b.revision ?? 1) + 1})?`)) return
		revising = b.id
		try {
			const res = await api.post<{ success: boolean; data: { id: string; revision: number } }>(
				`/api/boms/${b.id}/revise`,
				{}
			)
			toast.success(`Revision ${res.data.revision} created as draft`)
			loadBoms()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			revising = ''
		}
	}

	async function openBomDetail(b: BomListItem) {
		bomDetailLoading = true
		bomDetailView = null
		try {
			const res = await api.get<{ success: boolean; data: BomDetail }>(`/api/boms/${b.id}`)
			bomDetailView = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			bomDetailLoading = false
		}
	}

	// ---- production orders ----
	let orders = $state<ProductionOrderListItem[]>([])
	let ordersMeta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let ordersLoading = $state(true)
	let ordersStatus = $state('')
	let ordersPage = $state(1)

	let poOpen = $state(false)
	let poSaving = $state(false)
	let poBomId = $state('')
	let poQty = $state('1')
	let poNotes = $state('')

	let poDetailView = $state<ProductionOrderDetail | null>(null)
	let poDetailLoading = $state(false)
	let busyAction = $state('')

	async function loadOrders() {
		ordersLoading = true
		try {
			const res = await api.get<{
				success: boolean
				data: { items: ProductionOrderListItem[]; meta: PaginationMeta }
			}>('/api/production-orders', {
				page: ordersPage,
				...(ordersStatus ? { status: ordersStatus } : {})
			})
			orders = res.data.items
			ordersMeta = res.data.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			ordersLoading = false
		}
	}

	function applyOrderFilters() {
		ordersPage = 1
		loadOrders()
	}

	function onOrdersPage(p: number) {
		ordersPage = p
		loadOrders()
	}

	function openNewOrder() {
		poBomId = ''
		poQty = '1'
		poNotes = ''
		poOpen = true
	}

	async function saveOrder() {
		if (!poBomId) {
			toast.error('Select a BOM')
			return
		}
		const qty = Number(poQty)
		if (!Number.isInteger(qty) || qty < 1) {
			toast.error('Planned quantity must be a positive integer')
			return
		}
		poSaving = true
		try {
			await api.post<{ success: boolean }>('/api/production-orders', {
				bomId: poBomId,
				quantity: qty,
				...(poNotes.trim() ? { notes: poNotes.trim() } : {})
			})
			toast.success('Production order created')
			poOpen = false
			loadOrders()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			poSaving = false
		}
	}

	async function startOrder(o: ProductionOrderListItem) {
		busyAction = `start:${o.id}`
		try {
			await api.post<{ success: boolean }>(`/api/production-orders/${o.id}/start`)
			toast.success('Production order started')
			loadOrders()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busyAction = ''
		}
	}

	async function completeOrder(o: ProductionOrderListItem) {
		busyAction = `complete:${o.id}`
		try {
			const res = await api.post<{ success: boolean; data: { id: string; status: string; outputQuantity: number } }>(
				`/api/production-orders/${o.id}/complete`,
				{}
			)
			toast.success(`Completed — produced ${number(res.data.outputQuantity)} units`)
			loadOrders()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busyAction = ''
		}
	}

	async function cancelOrder(o: ProductionOrderListItem) {
		if (!confirm(`Cancel production order ${o.productionNumber}?`)) return
		busyAction = `cancel:${o.id}`
		try {
			await api.post<{ success: boolean }>(`/api/production-orders/${o.id}/cancel`)
			toast.success('Production order cancelled')
			loadOrders()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busyAction = ''
		}
	}

	async function openOrderDetail(o: ProductionOrderListItem) {
		poDetailLoading = true
		poDetailView = null
		try {
			const res = await api.get<{ success: boolean; data: ProductionOrderDetail }>(`/api/production-orders/${o.id}`)
			poDetailView = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			poDetailLoading = false
		}
	}

	function switchTab(t: Tab) {
		tab = t
		if (t === 'boms') {
			bomsPage = 1
			loadBoms()
		} else {
			ordersPage = 1
			loadOrders()
		}
	}

	onMount(() => {
		loadBoms()
		loadOrders()
	})

	const tabs: Array<{ id: Tab; label: string }> = [
		{ id: 'boms', label: 'BOMs' },
		{ id: 'production-orders', label: 'Production Orders' }
	]
</script>

<svelte:head>
	<title>Production — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Production</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage bills of materials and production orders.</p>
		</div>
		{#if canManage()}
			{#if tab === 'boms'}
				<Button size="sm" onclick={openNewBom}><Icon name="add" size="text-[16px]" /> New BOM</Button>
			{:else}
				<Button size="sm" onclick={openNewOrder}><Icon name="add" size="text-[16px]" /> New production order</Button>
			{/if}
		{/if}
	</div>

	<div class="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
		{#each tabs as t (t.id)}
			<button
				class="rounded-md px-3 py-1.5 text-sm font-medium max-sm:min-h-11 max-sm:inline-flex max-sm:items-center transition-colors {tab === t.id ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}"
				onclick={() => switchTab(t.id)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	{#if tab === 'boms'}
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-[200px] flex-1">
				<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
					<Icon name="search" size="text-[16px]" />
				</div>
				<input class="field pl-9" placeholder="Search BOMs…" aria-label="Search BOMs" bind:value={bomsSearch} onkeydown={(e) => e.key === 'Enter' && applyBomFilters()} />
			</div>
			<select class="field w-auto" bind:value={bomsStatus} aria-label="Filter by status">
				<option value="">All statuses</option>
				<option value="draft">Draft</option>
				<option value="active">Active</option>
				<option value="inactive">Inactive</option>
			</select>
			<Button variant="secondary" size="sm" onclick={applyBomFilters}>Apply</Button>
		</div>

		<Card padded={false}>
			{#if bomsLoading}
				<div class="space-y-2 p-5">
					{#each Array(6) as _}
						<div class="h-12 animate-pulse rounded bg-surface-container"></div>
					{/each}
				</div>
			{:else if boms.length === 0}
				<div class="flex flex-col items-center gap-2 py-16 text-center">
					<Icon name="inventory_2" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No BOMs yet.</p>
				</div>
			{:else}
				<div class="hidden overflow-x-auto md:block">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">Name</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Rev</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Output</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Output qty</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Scrap / Yield</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Components</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
								{#if canManage()}
									<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each boms as b (b.id)}
								<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
									<td class="px-table-cell-x py-table-cell-y">
										<button class="rounded font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant" onclick={() => openBomDetail(b)}>{b.name}</button>
										{#if b.revisionOf}
											<div class="text-xs text-outline">rev of #{String(b.revisionOf).slice(0, 8).toUpperCase()}</div>
										{/if}
									</td>
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">r{b.revision ?? 1}</td>
									<td class="px-table-cell-x py-table-cell-y">
										<div class="font-medium text-on-surface">{b.productName}</div>
										<div class="text-xs text-secondary">{optText(b.optionValues)} · {b.sku ?? '—'}</div>
									</td>
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{number(b.outputQuantity)}</td>
									<td class="px-table-cell-x py-table-cell-y text-xs text-on-surface-variant">{Number(b.scrapPercent ?? 0)}% / {Number(b.yieldPercent ?? 100)}%</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(b.componentCount)}</td>
									<td class="px-table-cell-x py-table-cell-y"><Badge label={b.status} /></td>
									<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(b.createdAt)}</td>
									{#if canManage()}
										<td class="px-table-cell-x py-table-cell-y text-right whitespace-nowrap">
											<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEditBom(b)}>Edit</button>
											<span class="mx-1 text-outline">|</span>
											<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40 disabled:opacity-50" disabled={revising === b.id} onclick={() => reviseBom(b)}>Revise</button>
											<span class="mx-1 text-outline">|</span>
											{#if b.status === 'active'}
												<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => setBomStatus(b, 'inactive')}>Set inactive</button>
											{:else}
												<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => setBomStatus(b, 'active')}>Set active</button>
											{/if}
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="divide-y divide-outline-variant/60 md:hidden">
					{#each boms as b (b.id)}
						<div class="px-4 py-3">
							<button class="font-medium text-primary" onclick={() => openBomDetail(b)}>{b.name}</button>
							<div class="flex items-center gap-2">
								<Badge label={b.status} />
								<span class="text-xs text-secondary">{number(b.componentCount)} components · output {number(b.outputQuantity)}</span>
							</div>
							<p class="mt-0.5 text-xs text-secondary">{b.productName} · {optText(b.optionValues)}</p>
							{#if canManage()}
								<div class="mt-1 flex gap-2">
									<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEditBom(b)}>Edit</button>
									{#if b.status === 'active'}
										<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => setBomStatus(b, 'inactive')}>Set inactive</button>
									{:else}
										<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => setBomStatus(b, 'active')}>Set active</button>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<Pagination meta={bomsMeta} onPage={onBomsPage} />
			{/if}
		</Card>
	{:else}
		<div class="flex flex-wrap items-center gap-3">
			<select class="field w-auto" bind:value={ordersStatus} aria-label="Filter by status">
				<option value="">All statuses</option>
				<option value="planned">Planned</option>
				<option value="in_progress">In progress</option>
				<option value="completed">Completed</option>
				<option value="cancelled">Cancelled</option>
			</select>
			<Button variant="secondary" size="sm" onclick={applyOrderFilters}>Apply</Button>
		</div>

		<Card padded={false}>
			{#if ordersLoading}
				<div class="space-y-2 p-5">
					{#each Array(6) as _}
						<div class="h-12 animate-pulse rounded bg-surface-container"></div>
					{/each}
				</div>
			{:else if orders.length === 0}
				<div class="flex flex-col items-center gap-2 py-16 text-center">
					<Icon name="inventory_2" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No production orders yet.</p>
				</div>
			{:else}
				<div class="hidden overflow-x-auto md:block">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">BOM</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Planned qty</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Progress</th>
								{#if canManage()}
									<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each orders as o (o.id)}
								<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{o.productionNumber}</td>
									<td class="px-table-cell-x py-table-cell-y">
										<div class="font-medium text-on-surface">{o.bomName}</div>
										<div class="text-xs text-secondary">{o.productName} · {optText(o.optionValues)}</div>
									</td>
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{number(o.quantity)}</td>
									<td class="px-table-cell-x py-table-cell-y"><Badge label={o.status} /></td>
									<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(o.createdAt)}</td>
									<td class="px-table-cell-x py-table-cell-y text-secondary">
										{#if o.completedAt}
											Completed {dateTime(o.completedAt)}
										{:else if o.startedAt}
											Started {dateTime(o.startedAt)}
										{:else}
											—
										{/if}
									</td>
									{#if canManage()}
										<td class="px-table-cell-x py-table-cell-y text-right whitespace-nowrap">
											<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openOrderDetail(o)}>View</button>
											{#if o.status === 'planned'}
												<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => startOrder(o)}>Start</button>
											{/if}
											{#if o.status === 'in_progress'}
												<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => completeOrder(o)}>Complete</button>
											{/if}
											{#if o.status === 'planned' || o.status === 'in_progress'}
												<button class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => cancelOrder(o)}>Cancel</button>
											{/if}
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="divide-y divide-outline-variant/60 md:hidden">
					{#each orders as o (o.id)}
						<div class="px-4 py-3">
							<div class="flex items-center gap-2">
								<span class="font-mono-label text-mono-label text-on-surface">{o.productionNumber}</span>
								<Badge label={o.status} />
							</div>
							<p class="mt-1 text-xs text-secondary">{o.bomName} · {o.productName} · qty {number(o.quantity)}</p>
							{#if canManage()}
								<div class="mt-1 flex gap-2">
									<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openOrderDetail(o)}>View</button>
									{#if o.status === 'planned'}
										<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => startOrder(o)}>Start</button>
									{/if}
									{#if o.status === 'in_progress'}
										<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => completeOrder(o)}>Complete</button>
									{/if}
									{#if o.status === 'planned' || o.status === 'in_progress'}
										<button class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => cancelOrder(o)}>Cancel</button>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<Pagination meta={ordersMeta} onPage={onOrdersPage} />
			{/if}
		</Card>
	{/if}
</div>

{#if bomModal && canManage()}
	<Modal
		title={bomModal === 'edit' ? 'Edit BOM' : 'New BOM'}
		open={true}
		width="lg"
		onClose={() => (bomModal = null)}
	>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveBom() }}>
			<div>
				<label for="bom-name" class="field-label">Name</label>
				<input id="bom-name" class="field" bind:value={bomName} placeholder="e.g. Finished product — 1 run" />
			</div>

			<div>
				<p class="field-label mb-2">Output</p>
				<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
					{#if bomModal === 'edit'}
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<label class="field-label" for="bom-output-product">Output product</label>
								<input id="bom-output-product" class="field" value={pickerProducts.find((p) => p.id === bomOutputProductId)?.name ?? ''} disabled />
							</div>
							<div>
								<label class="field-label" for="bom-output-variant-ro">Output variant</label>
								<input id="bom-output-variant-ro" class="field" value={variantLabel(variantsByProduct[bomOutputProductId]?.find((v) => v.id === bomOutputVariantId) ?? { id: '', productId: '', optionValues: {}, sku: null, price: 0, inventory: 0 })} disabled />
							</div>
						</div>
						<p class="mt-1 text-xs text-secondary">The output and its quantity are locked once a BOM is created.</p>
					{:else}
						<div class="flex flex-wrap items-end gap-2">
							<div class="relative min-w-[180px] flex-1">
								<label class="field-label" for="picker-search">Search products</label>
								<input id="picker-search" class="field" bind:value={pickerSearch} placeholder="Search products…" onkeydown={(e) => e.key === 'Enter' && applyPicker()} />
							</div>
							<Button variant="secondary" size="sm" loading={pickerLoading} onclick={applyPicker}>Search</Button>
						</div>
						<p class="mt-1 text-xs text-secondary">
							{pickerMeta.total} products · page {pickerMeta.page} of {pickerMeta.totalPages}
							<button type="button" class="rounded px-1.5 text-primary hover:bg-primary-fixed-dim/40" onclick={pickerPrev}>‹</button>
							<button type="button" class="rounded px-1.5 text-primary hover:bg-primary-fixed-dim/40" onclick={pickerNext}>›</button>
						</p>
						<div class="mt-2 grid gap-3 sm:grid-cols-2">
							<div>
								<label class="field-label" for="bom-output-product">Output product</label>
								<select id="bom-output-product" class="field" bind:value={bomOutputProductId} onchange={() => { bomOutputVariantId = ''; loadVariants(bomOutputProductId) }}>
									<option value="">Select product…</option>
									{#each pickerProducts as p (p.id)}
										<option value={p.id}>{productLabel(p)}</option>
									{/each}
								</select>
							</div>
							<div>
								<label class="field-label" for="bom-output-variant">Output variant</label>
								<select id="bom-output-variant" class="field" bind:value={bomOutputVariantId} disabled={!(variantsByProduct[bomOutputProductId]?.length)}>
									<option value="">{bomOutputProductId ? (variantLoadingProduct === bomOutputProductId ? 'Loading variants…' : 'Select variant…') : 'Select a product first'}</option>
									{#each variantsByProduct[bomOutputProductId] ?? [] as v (v.id)}
										<option value={v.id}>{variantLabel(v)}</option>
									{/each}
								</select>
							</div>
						</div>
					{/if}
					<div class="mt-3 grid gap-3 sm:grid-cols-3">
						<div>
							<label class="field-label" for="bom-out-qty">Output quantity</label>
							<input id="bom-out-qty" type="number" min="1" step="1" class="field" bind:value={bomOutputQty} disabled={bomModal === 'edit'} />
						</div>
						<div>
							<label class="field-label" for="bom-scrap">Scrap % (extra consumption)</label>
							<input id="bom-scrap" type="number" min="0" max="100" step="0.1" class="field" bind:value={bomScrap} />
						</div>
						<div>
							<label class="field-label" for="bom-yield">Yield % (output multiplier)</label>
							<input id="bom-yield" type="number" min="0.1" max="100" step="0.1" class="field" bind:value={bomYield} />
						</div>
					</div>
					<p class="mt-1 text-xs text-secondary">Completion consumes components × (1 + scrap%) rounded up, and produces output × yield% rounded down (min 1).</p>
				</div>
			</div>

			<div>
				<div class="mb-2 flex items-center justify-between">
					<p class="field-label">Components</p>
					{#if bomModal === 'new' || bomDetail?.status === 'draft'}
						<button type="button" class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={addBomRow}>+ Add component</button>
					{/if}
				</div>
				<div class="space-y-3">
					{#each bomRows as row, i (i)}
						<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
							<div class="flex flex-wrap items-end gap-2">
								<div class="min-w-[180px] flex-1">
									<label class="field-label" for={`comp-product-${i}`}>Product</label>
									<select id={`comp-product-${i}`} class="field" bind:value={bomRows[i].productId} disabled={bomModal === 'edit' && bomDetail?.status !== 'draft'} onchange={() => { bomRows[i].variantId = ''; loadVariants(bomRows[i].productId) }}>
										<option value="">Select product…</option>
										{#each pickerProducts as p (p.id)}
											<option value={p.id}>{productLabel(p)}</option>
										{/each}
									</select>
								</div>
								<div class="min-w-[160px] flex-1">
									<label class="field-label" for={`comp-variant-${i}`}>Variant</label>
									<select id={`comp-variant-${i}`} class="field" bind:value={bomRows[i].variantId} disabled={bomModal === 'edit' && bomDetail?.status !== 'draft'}>
										<option value="">{bomRows[i].productId ? (variantLoadingProduct === bomRows[i].productId ? 'Loading variants…' : 'Select variant…') : 'Select a product first'}</option>
										{#each variantsByProduct[bomRows[i].productId] ?? [] as v (v.id)}
											<option value={v.id}>{variantLabel(v)}</option>
										{/each}
									</select>
								</div>
								<div class="w-24">
									<label class="field-label" for={`comp-qty-${i}`}>Qty</label>
									<input id={`comp-qty-${i}`} type="number" min="1" step="1" class="field" bind:value={bomRows[i].quantity} disabled={bomModal === 'edit' && bomDetail?.status !== 'draft'} />
								</div>
								{#if bomModal === 'new' || bomDetail?.status === 'draft'}
									<button type="button" class="rounded p-2 text-sm text-outline hover:bg-error-container/40 hover:text-error" aria-label="Remove component" onclick={() => removeBomRow(i)}>×</button>
								{/if}
							</div>
						</div>
					{/each}
					{#if bomRows.length === 0}
						<p class="rounded-lg border border-dashed border-outline-variant p-4 text-center text-sm text-secondary">No components. Add at least one.</p>
					{/if}
					{#if bomModal === 'edit' && bomDetail?.status !== 'draft'}
						<p class="text-xs text-secondary">Components are locked — they can only be changed while the BOM is a draft.</p>
					{/if}
				</div>
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="field-label" for="bom-notes">Notes</label>
					<textarea id="bom-notes" class="field" rows="2" bind:value={bomNotes} placeholder="Optional notes"></textarea>
				</div>
				{#if bomModal === 'edit'}
					<div>
						<label class="field-label" for="bom-status">Status</label>
						<select id="bom-status" class="field" bind:value={bomStatus}>
							<option value="draft">Draft</option>
							<option value="active">Active</option>
							<option value="inactive">Inactive</option>
						</select>
					</div>
				{/if}
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (bomModal = null)}>Cancel</Button>
				<Button type="submit" loading={bomSaving}>{bomModal === 'edit' ? 'Save changes' : 'Create BOM'}</Button>
			</div>
		</form>
	</Modal>
{/if}

{#if bomDetailView}
	<Modal title={bomDetailView.name} open={true} width="lg" onClose={() => (bomDetailView = null)}>
		<div class="space-y-4">
			<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
				<div class="flex items-center gap-2">
					<h4 class="text-sm font-semibold text-on-surface">Output</h4>
					<Badge label={bomDetailView.status} />
					<span class="text-xs text-secondary">rev {bomDetailView.revision ?? 1}</span>
				</div>
				<p class="mt-2 text-sm text-on-surface">{bomDetailView.output.name}</p>
				<p class="text-xs text-secondary">{optText(bomDetailView.output.optionValues)} · {bomDetailView.output.sku ?? '—'}</p>
				<p class="mt-1 text-xs text-secondary">Quantity per run: <span class="font-mono-label text-mono-label text-on-surface">{number(bomDetailView.outputQuantity)}</span> · Scrap {Number(bomDetailView.scrapPercent ?? 0)}% · Yield {Number(bomDetailView.yieldPercent ?? 100)}%</p>
				{#if bomDetailView.notes}
					<p class="mt-1 text-xs text-secondary">{bomDetailView.notes}</p>
				{/if}
			</div>

			<div>
				<h4 class="mb-2 text-sm font-semibold text-on-surface">Components</h4>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">Variant</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">SKU</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Qty</th>
							</tr>
						</thead>
						<tbody>
							{#each bomDetailView.items as it (it.id)}
								<tr class="border-b border-outline-variant/60">
									<td class="px-table-cell-x py-table-cell-y">
										<div class="font-medium text-on-surface">{it.productName}</div>
										<div class="text-xs text-secondary">{optText(it.optionValues)}</div>
									</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{it.sku ?? '—'}</td>
									<td class="px-table-cell-x py-table-cell-y text-right font-mono-label text-mono-label text-on-surface">{number(it.quantity)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	</Modal>
{/if}

{#if poOpen && canManage()}
	<Modal title="New production order" open={true} width="md" onClose={() => (poOpen = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); saveOrder() }}>
			<div>
				<label for="po-bom" class="field-label">BOM</label>
				<select id="po-bom" class="field" bind:value={poBomId}>
					<option value="">Select BOM…</option>
					{#each boms as b (b.id)}
						<option value={b.id} disabled={b.status !== 'active'}>
							{b.name}{b.status !== 'active' ? ' (not active)' : ''}
						</option>
					{/each}
				</select>
				<p class="mt-1 text-xs text-secondary">Only active BOMs can be produced.</p>
			</div>
			<div>
				<label for="po-qty" class="field-label">Planned quantity (number of BOM runs)</label>
				<input id="po-qty" type="number" min="1" step="1" class="field" bind:value={poQty} />
			</div>
			<div>
				<label for="po-notes" class="field-label">Notes</label>
				<textarea id="po-notes" class="field" rows="2" bind:value={poNotes} placeholder="Optional notes"></textarea>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (poOpen = false)}>Cancel</Button>
				<Button type="submit" loading={poSaving}>Create order</Button>
			</div>
		</form>
	</Modal>
{/if}

{#if poDetailView}
	<Modal title={poDetailView.productionNumber} open={true} width="lg" onClose={() => (poDetailView = null)}>
		<div class="space-y-4">
			<div class="flex flex-wrap items-center gap-2">
				<Badge label={poDetailView.status} />
				<span class="text-xs text-secondary">Created {dateTime(poDetailView.createdAt)}</span>
				{#if poDetailView.startedAt}
					<span class="text-xs text-secondary">Started {dateTime(poDetailView.startedAt)}</span>
				{/if}
				{#if poDetailView.completedAt}
					<span class="text-xs text-secondary">Completed {dateTime(poDetailView.completedAt)}</span>
				{/if}
				{#if poDetailView.cancelledAt}
					<span class="text-xs text-secondary">Cancelled {dateTime(poDetailView.cancelledAt)}</span>
				{/if}
			</div>

			<div class="grid gap-3 sm:grid-cols-3">
				<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
					<p class="text-xs text-secondary">BOM</p>
					<p class="mt-1 text-sm font-semibold text-on-surface">{poDetailView.bom.name}</p>
					<p class="text-xs text-secondary">Status <Badge label={poDetailView.bom.status} /></p>
				</div>
				<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
					<p class="text-xs text-secondary">Planned runs</p>
					<p class="mt-1 text-sm font-semibold text-on-surface">{number(poDetailView.quantity)}</p>
				</div>
				<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
					<p class="text-xs text-secondary">Output per run</p>
					<p class="mt-1 text-sm font-semibold text-on-surface">{number(poDetailView.bom.outputQuantity)}</p>
				</div>
			</div>

			{#if poDetailView.notes}
				<p class="text-sm text-secondary">{poDetailView.notes}</p>
			{/if}

			<div>
				<h4 class="mb-2 text-sm font-semibold text-on-surface">Stock movements</h4>
				{#if poDetailView.items.length === 0}
					<p class="py-6 text-center text-sm text-secondary">No stock movements recorded yet.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
									<th class="px-table-cell-x py-table-cell-y font-semibold">Variant</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">SKU</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Change</th>
									<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Before → After</th>
								</tr>
							</thead>
							<tbody>
								{#each poDetailView.items as it (it.id)}
									<tr class="border-b border-outline-variant/60">
										<td class="px-table-cell-x py-table-cell-y">
											<div class="font-medium text-on-surface">{it.productName}</div>
											<div class="text-xs text-secondary">{optText(it.optionValues)}</div>
										</td>
										<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{it.sku ?? '—'}</td>
										<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label font-semibold" class:text-success={it.change > 0} class:text-error={it.change < 0}>
											{it.change > 0 ? `+${number(it.change)}` : number(it.change)}
										</td>
										<td class="px-table-cell-x py-table-cell-y text-right font-mono-label text-mono-label text-on-surface">{number(it.beforeValue)} → {number(it.afterValue)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	</Modal>
{/if}