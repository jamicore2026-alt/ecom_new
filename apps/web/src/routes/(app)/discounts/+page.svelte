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
	import { currency, dateTime, titleCase } from '$lib/format'
	import type { Category, Coupon, CouponType, PaginationMeta, Promotion, PromotionType } from '$lib/types'

	type Section = 'coupons' | 'promotions'
	let section = $state<Section>('coupons')

	let coupons = $state<Coupon[]>([])
	let promotions = $state<Promotion[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let products = $state<Array<{ id: string; name: string }>>([])
	let categories = $state<Category[]>([])
	let loading = $state(true)

	// filters
	let search = $state('')
	let statusFilter = $state('')
	let page = $state(1)

	// forms
	let createOpen = $state(false)
	let editingCoupon = $state<Coupon | null>(null)
	let editingPromotion = $state<Promotion | null>(null)
	let isPromotion = $state(false)
	let saving = $state(false)
	let fieldErrors = $state<Record<string, string>>({})

	// coupon fields
	let code = $state('')
	let type = $state<CouponType>('percentage')
	let value = $state('')
	let minSubtotal = $state('')
	let usageLimit = $state('')
	let startsAt = $state('')
	let endsAt = $state('')
	let cStatus = $state('active')

	// promotion fields
	let pName = $state('')
	let pType = $state<PromotionType>('discount_on_products')
	let pDiscount = $state('')
	let pScope = $state<'all' | 'products' | 'category'>('all')
	let pProductIds = $state<string[]>([])
	let pCategoryId = $state('')
	let pStartsAt = $state('')
	let pEndsAt = $state('')
	let pStatus = $state('active')

	const canWrite = () => session.can('discounts:write')

	function params(extra: Record<string, string> = {}): Record<string, string> {
		return { page: String(page), ...extra }
	}

	async function load() {
		loading = true
		try {
			if (section === 'coupons') {
				const res = await api.get<{ success: boolean; data: { items: Coupon[]; meta: PaginationMeta } }>(
					'/api/coupons',
					params({ ...(search ? { search } : {}), ...(statusFilter ? { status: statusFilter } : {}) })
				)
				coupons = res.data.items
				meta = res.data.meta
			} else {
				const res = await api.get<{ success: boolean; data: { items: Promotion[]; meta: PaginationMeta } }>(
					'/api/promotions',
					params(statusFilter ? { status: statusFilter } : {})
				)
				promotions = res.data.items
				meta = res.data.meta
			}
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function loadOptions() {
		try {
			const [p, c] = await Promise.all([
				api.get<{ success: boolean; data: { items: Array<{ id: string; name: string }> } }>('/api/products', { limit: '100' }),
				api.get<{ success: boolean; data: { items: Category[] } }>('/api/categories')
			])
			products = p.data.items
			categories = c.data.items
		} catch {
			/* non-fatal */
		}
	}

	onMount(() => {
		load()
		loadOptions()
	})

	function switchSection(s: Section) {
		section = s
		page = 1
		statusFilter = ''
		load()
	}

	function onPage(p: number) {
		page = p
		load()
	}

	function resetForm() {
		editingCoupon = null
		editingPromotion = null
		code = ''
		type = 'percentage'
		value = ''
		minSubtotal = ''
		usageLimit = ''
		startsAt = ''
		endsAt = ''
		cStatus = 'active'
		pName = ''
		pType = 'discount_on_products'
		pDiscount = ''
		pScope = 'all'
		pProductIds = []
		pCategoryId = ''
		pStartsAt = ''
		pEndsAt = ''
		pStatus = 'active'
		fieldErrors = {}
	}

	function openCreate(s: Section) {
		resetForm()
		isPromotion = s === 'promotions'
		createOpen = true
	}

	function openEditCoupon(c: Coupon) {
		resetForm()
		isPromotion = false
		editingCoupon = c
		code = c.code
		type = c.type
		value = String(c.value)
		minSubtotal = String(c.minSubtotal)
		usageLimit = c.usageLimit != null ? String(c.usageLimit) : ''
		startsAt = c.startsAt ? c.startsAt.slice(0, 10) : ''
		endsAt = c.endsAt ? c.endsAt.slice(0, 10) : ''
		cStatus = c.status
		createOpen = true
	}

	function openEditPromotion(p: Promotion) {
		resetForm()
		isPromotion = true
		editingPromotion = p
		pName = p.name
		pType = p.type
		pDiscount = String(p.discountPercent)
		pScope = p.appliesTo.scope
		pProductIds = p.appliesTo.productIds ?? []
		pCategoryId = p.appliesTo.categoryId ?? ''
		pStartsAt = p.startsAt ? p.startsAt.slice(0, 10) : ''
		pEndsAt = p.endsAt ? p.endsAt.slice(0, 10) : ''
		pStatus = p.status
		createOpen = true
	}

	async function submit() {
		saving = true
		fieldErrors = {}
		try {
			if (isPromotion) {
				const body: Record<string, unknown> = {
					name: pName,
					type: pType,
					discountPercent: Number(pDiscount),
					appliesTo: { scope: pScope, ...(pScope === 'products' ? { productIds: pProductIds } : {}), ...(pScope === 'category' ? { categoryId: pCategoryId } : {}) },
					startsAt: pStartsAt || undefined,
					endsAt: pEndsAt || undefined,
					status: pStatus
				}
				if (editingPromotion) {
					await api.put<{ success: boolean }>(`/api/promotions/${editingPromotion.id}`, body)
					toast.success('Promotion updated')
				} else {
					await api.post<{ success: boolean }>('/api/promotions', body)
					toast.success('Promotion created')
				}
			} else {
				const body: Record<string, unknown> = {
					code,
					type,
					value: Number(value),
					minSubtotal: minSubtotal ? Number(minSubtotal) : undefined,
					usageLimit: usageLimit ? Number(usageLimit) : undefined,
					startsAt: startsAt || undefined,
					endsAt: endsAt || undefined,
					status: cStatus
				}
				if (editingCoupon) {
					const { code: _c, ...rest } = body
					await api.put<{ success: boolean }>(`/api/coupons/${editingCoupon.id}`, rest)
					toast.success('Coupon updated')
				} else {
					await api.post<{ success: boolean }>('/api/coupons', body)
					toast.success('Coupon created')
				}
			}
			createOpen = false
			load()
		} catch (e) {
			const err = e as { message?: string; fields?: Array<{ path: string; message: string }> }
			toast.error(err.message ?? 'Save failed')
			if (err.fields) {
				for (const f of err.fields) fieldErrors[f.path] = f.message
			}
		} finally {
			saving = false
		}
	}

	async function toggleCoupon(c: Coupon) {
		try {
			await api.put<{ success: boolean }>(`/api/coupons/${c.id}`, { status: c.status === 'active' ? 'disabled' : 'active' })
			toast.success('Coupon updated')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function togglePromotion(p: Promotion) {
		try {
			await api.put<{ success: boolean }>(`/api/promotions/${p.id}`, { status: p.status === 'active' ? 'disabled' : 'active' })
			toast.success('Promotion updated')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function removeCoupon(c: Coupon) {
		if (!confirm(`Disable coupon ${c.code}?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/coupons/${c.id}`)
			toast.success('Coupon disabled')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function removePromotion(p: Promotion) {
		if (!confirm(`Disable promotion "${p.name}"?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/promotions/${p.id}`)
			toast.success('Promotion disabled')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}
</script>

<svelte:head>
	<title>Discounts — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Discounts</h1>
			<p class="mt-1 text-body-sm text-secondary">{meta.total} total</p>
		</div>
		{#if canWrite()}
			<Button onclick={() => openCreate(section)}><Icon name="add" size="text-[18px]" /> Add {section === 'coupons' ? 'coupon' : 'promotion'}</Button>
		{/if}
	</div>

	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex w-fit gap-1 rounded border border-outline-variant bg-surface-container-lowest p-1">
			<button class="rounded px-3 py-1.5 text-sm font-medium transition-colors {section === 'coupons' ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}" onclick={() => switchSection('coupons')}>
				Coupons
			</button>
			<button class="rounded px-3 py-1.5 text-sm font-medium transition-colors {section === 'promotions' ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}" onclick={() => switchSection('promotions')}>
				Promotions
			</button>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if section === 'coupons'}
				<div class="relative min-w-[180px]">
					<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
						<Icon name="search" size="text-[16px]" />
					</div>
					<input class="field pl-9" placeholder="Search code…" bind:value={search} onkeydown={(e) => { if (e.key === 'Enter') { page = 1; load() } }} />
				</div>
			{/if}
			<select class="field w-auto" bind:value={statusFilter}>
				<option value="">All statuses</option>
				<option value="active">Active</option>
				<option value="disabled">Disabled</option>
			</select>
			<Button variant="secondary" size="sm" onclick={() => { page = 1; load() }}>Apply</Button>
		</div>
	</div>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if section === 'coupons' && coupons.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="percent" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No coupons found.</p>
			</div>
		{:else if section === 'promotions' && promotions.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="campaign" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No promotions found.</p>
			</div>
		{:else if section === 'coupons'}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Code</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Type</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Value</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Min subtotal</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Usage</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Dates</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							{#if canWrite()}<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each coupons as c (c.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label font-medium text-primary">{c.code}</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={c.type} /></td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{c.type === 'free_shipping' ? '—' : c.type === 'percentage' ? `${c.value}%` : currency(c.value)}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{c.minSubtotal ? currency(c.minSubtotal) : '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{c.usedCount}{c.usageLimit != null ? ` / ${c.usageLimit}` : ''}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">
									{#if c.startsAt || c.endsAt}
										{c.startsAt ? dateTime(c.startsAt) : '∞'} → {c.endsAt ? dateTime(c.endsAt) : '∞'}
									{:else}Always{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={c.status} /></td>
								{#if canWrite()}
									<td class="whitespace-nowrap px-table-cell-x py-table-cell-y text-right">
										<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEditCoupon(c)}>Edit</button>
										<button class="rounded p-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container" onclick={() => toggleCoupon(c)}>{c.status === 'active' ? 'Disable' : 'Enable'}</button>
										<button class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => removeCoupon(c)}>Delete</button>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Name</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Type</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Discount</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Applies to</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Dates</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							{#if canWrite()}<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each promotions as p (p.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y font-medium text-on-surface">{p.name}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{titleCase(p.type)}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{p.discountPercent}%</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">
									{p.appliesTo.scope}{#if p.appliesTo.scope === 'products'}<span class="text-outline"> · {p.appliesTo.productIds?.length ?? 0} products</span>{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">
									{#if p.startsAt || p.endsAt}
										{p.startsAt ? dateTime(p.startsAt) : '∞'} → {p.endsAt ? dateTime(p.endsAt) : '∞'}
									{:else}Always{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={p.status} /></td>
								{#if canWrite()}
									<td class="whitespace-nowrap px-table-cell-x py-table-cell-y text-right">
										<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEditPromotion(p)}>Edit</button>
										<button class="rounded p-1.5 text-xs font-medium text-on-surface-variant hover:bg-surface-container" onclick={() => togglePromotion(p)}>{p.status === 'active' ? 'Disable' : 'Enable'}</button>
										<button class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => removePromotion(p)}>Delete</button>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		{/if}
	</Card>
</div>

{#if createOpen && canWrite()}
	<Modal title={isPromotion ? (editingPromotion ? 'Edit promotion' : 'New promotion') : editingCoupon ? `Edit ${editingCoupon.code}` : 'New coupon'} open={true} width="md" onClose={() => (createOpen = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); submit() }}>
			{#if isPromotion}
				<div>
					<label class="field-label">Name *</label>
					<input class="field" bind:value={pName} required />
					{#if fieldErrors.name}<p class="field-error">{fieldErrors.name}</p>{/if}
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="field-label">Type</label>
						<select class="field" bind:value={pType}>
							<option value="discount_on_products">Discount on products</option>
							<option value="buy_x_get_y">Buy X get Y</option>
						</select>
					</div>
					<div>
						<label class="field-label">Discount %</label>
						<input type="number" min="0" max="100" class="field" bind:value={pDiscount} required />
					</div>
				</div>
				<div>
					<label class="field-label">Applies to</label>
					<select class="field" bind:value={pScope}>
						<option value="all">All products</option>
						<option value="products">Specific products</option>
						<option value="category">Category</option>
					</select>
				</div>
				{#if pScope === 'products'}
					<div>
						<label class="field-label">Products</label>
						<div class="max-h-40 space-y-1 overflow-y-auto rounded border border-outline-variant bg-surface-container-lowest p-2">
							{#each products as p (p.id)}
								<label class="flex items-center gap-2 text-sm text-on-surface-variant">
									<input type="checkbox" class="field-check" checked={pProductIds.includes(p.id)} onchange={() => { pProductIds = pProductIds.includes(p.id) ? pProductIds.filter((x) => x !== p.id) : [...pProductIds, p.id] }} />
									<span class="truncate">{p.name}</span>
								</label>
							{/each}
						</div>
					</div>
				{:else if pScope === 'category'}
					<div>
						<label class="field-label">Category</label>
						<select class="field" bind:value={pCategoryId}>
							<option value="">Select…</option>
							{#each categories as c (c.id)}
								<option value={c.id}>{c.name}</option>
							{/each}
						</select>
					</div>
				{/if}
			{:else}
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="field-label">Code *</label>
						<input class="field font-mono-label uppercase" bind:value={code} placeholder="SAVE10" disabled={!!editingCoupon} required />
						{#if fieldErrors.code}<p class="field-error">{fieldErrors.code}</p>{/if}
					</div>
					<div>
						<label class="field-label">Type</label>
						<select class="field" bind:value={type}>
							<option value="percentage">Percentage</option>
							<option value="fixed">Fixed amount</option>
							<option value="free_shipping">Free shipping</option>
						</select>
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="field-label">{type === 'percentage' ? 'Percent' : 'Amount'}</label>
						<input type="number" step="0.01" min="0" class="field" bind:value={value} required />
					</div>
					<div>
						<label class="field-label">Min subtotal</label>
						<input type="number" step="0.01" min="0" class="field" bind:value={minSubtotal} />
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="field-label">Usage limit</label>
						<input type="number" min="0" class="field" bind:value={usageLimit} placeholder="Unlimited" />
					</div>
					<div>
						<label class="field-label">Status</label>
						<select class="field" bind:value={cStatus}>
							<option value="active">Active</option>
							<option value="disabled">Disabled</option>
						</select>
					</div>
				</div>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="field-label">Start date</label>
					<input type="date" class="field" bind:value={startsAt} />
				</div>
				<div>
					<label class="field-label">End date</label>
					<input type="date" class="field" bind:value={endsAt} />
				</div>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button type="submit" loading={saving}>{editingCoupon || editingPromotion ? 'Save changes' : 'Create'}</Button>
			</div>
		</form>
	</Modal>
{/if}