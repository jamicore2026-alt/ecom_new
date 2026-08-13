<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
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

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold text-gray-900">Discounts</h1>
			<p class="text-sm text-gray-500">{meta.total} total</p>
		</div>
		{#if canWrite()}
			<Button onclick={() => openCreate(section)}>Add {section === 'coupons' ? 'coupon' : 'promotion'}</Button>
		{/if}
	</div>

	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
			<button class="rounded-md px-3 py-1.5 text-sm font-medium" class:bg-indigo-600={section === 'coupons'} class:text-white={section === 'coupons'} class:text-gray-600={section !== 'coupons'} onclick={() => switchSection('coupons')}>
				Coupons
			</button>
			<button class="rounded-md px-3 py-1.5 text-sm font-medium" class:bg-indigo-600={section === 'promotions'} class:text-white={section === 'promotions'} class:text-gray-600={section !== 'promotions'} onclick={() => switchSection('promotions')}>
				Promotions
			</button>
		</div>
		<div class="flex gap-2">
			{#if section === 'coupons'}
				<input class="w-48 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" placeholder="Search code…" bind:value={search} onkeydown={(e) => { if (e.key === 'Enter') { page = 1; load() } }} />
			{/if}
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={statusFilter}>
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
					<div class="h-12 animate-pulse rounded-lg bg-gray-100"></div>
				{/each}
			</div>
		{:else if section === 'coupons' && coupons.length === 0}
			<p class="py-14 text-center text-sm text-gray-400">No coupons found.</p>
		{:else if section === 'promotions' && promotions.length === 0}
			<p class="py-14 text-center text-sm text-gray-400">No promotions found.</p>
		{:else if section === 'coupons'}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
							<th class="px-5 py-3">Code</th>
							<th class="px-3 py-3">Type</th>
							<th class="px-3 py-3">Value</th>
							<th class="px-3 py-3">Min subtotal</th>
							<th class="px-3 py-3">Usage</th>
							<th class="px-3 py-3">Dates</th>
							<th class="px-3 py-3">Status</th>
							{#if canWrite()}<th class="px-5 py-3 text-right">Actions</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each coupons as c (c.id)}
							<tr class="border-b border-gray-50 hover:bg-gray-50/60">
								<td class="px-5 py-3 font-mono font-medium text-indigo-600">{c.code}</td>
								<td class="px-3 py-3"><Badge label={c.type} /></td>
								<td class="px-3 py-3">{c.type === 'free_shipping' ? '—' : c.type === 'percentage' ? `${c.value}%` : currency(c.value)}</td>
								<td class="px-3 py-3 text-gray-600">{c.minSubtotal ? currency(c.minSubtotal) : '—'}</td>
								<td class="px-3 py-3 text-gray-600">{c.usedCount}{c.usageLimit != null ? ` / ${c.usageLimit}` : ''}</td>
								<td class="px-3 py-3 text-gray-500">
									{#if c.startsAt || c.endsAt}
										{c.startsAt ? dateTime(c.startsAt) : '∞'} → {c.endsAt ? dateTime(c.endsAt) : '∞'}
									{:else}Always{/if}
								</td>
								<td class="px-3 py-3"><Badge label={c.status} /></td>
								{#if canWrite()}
									<td class="px-5 py-3 text-right whitespace-nowrap">
										<button class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => openEditCoupon(c)}>Edit</button>
										<span class="mx-1 text-gray-300">|</span>
										<button class="text-xs font-medium text-gray-600 hover:text-gray-800" onclick={() => toggleCoupon(c)}>{c.status === 'active' ? 'Disable' : 'Enable'}</button>
										<span class="mx-1 text-gray-300">|</span>
										<button class="text-xs font-medium text-red-600 hover:text-red-800" onclick={() => removeCoupon(c)}>Delete</button>
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
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
							<th class="px-5 py-3">Name</th>
							<th class="px-3 py-3">Type</th>
							<th class="px-3 py-3">Discount</th>
							<th class="px-3 py-3">Applies to</th>
							<th class="px-3 py-3">Dates</th>
							<th class="px-3 py-3">Status</th>
							{#if canWrite()}<th class="px-5 py-3 text-right">Actions</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each promotions as p (p.id)}
							<tr class="border-b border-gray-50 hover:bg-gray-50/60">
								<td class="px-5 py-3 font-medium text-gray-900">{p.name}</td>
								<td class="px-3 py-3 text-gray-700">{titleCase(p.type)}</td>
								<td class="px-3 py-3 font-medium">{p.discountPercent}%</td>
								<td class="px-3 py-3 text-gray-600">
									{p.appliesTo.scope}{#if p.appliesTo.scope === 'products'}<span class="text-gray-400"> · {p.appliesTo.productIds?.length ?? 0} products</span>{/if}
								</td>
								<td class="px-3 py-3 text-gray-500">
									{#if p.startsAt || p.endsAt}
										{p.startsAt ? dateTime(p.startsAt) : '∞'} → {p.endsAt ? dateTime(p.endsAt) : '∞'}
									{:else}Always{/if}
								</td>
								<td class="px-3 py-3"><Badge label={p.status} /></td>
								{#if canWrite()}
									<td class="px-5 py-3 text-right whitespace-nowrap">
										<button class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => openEditPromotion(p)}>Edit</button>
										<span class="mx-1 text-gray-300">|</span>
										<button class="text-xs font-medium text-gray-600 hover:text-gray-800" onclick={() => togglePromotion(p)}>{p.status === 'active' ? 'Disable' : 'Enable'}</button>
										<span class="mx-1 text-gray-300">|</span>
										<button class="text-xs font-medium text-red-600 hover:text-red-800" onclick={() => removePromotion(p)}>Delete</button>
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
					<label class="mb-1 block text-sm font-medium text-gray-700">Name *</label>
					<input class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={pName} required />
					{#if fieldErrors.name}<p class="mt-1 text-xs text-red-600">{fieldErrors.name}</p>{/if}
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Type</label>
						<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={pType}>
							<option value="discount_on_products">Discount on products</option>
							<option value="buy_x_get_y">Buy X get Y</option>
						</select>
					</div>
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Discount %</label>
						<input type="number" min="0" max="100" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={pDiscount} required />
					</div>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">Applies to</label>
					<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={pScope}>
						<option value="all">All products</option>
						<option value="products">Specific products</option>
						<option value="category">Category</option>
					</select>
				</div>
				{#if pScope === 'products'}
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Products</label>
						<div class="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
							{#each products as p (p.id)}
								<label class="flex items-center gap-2 text-sm text-gray-700">
									<input type="checkbox" class="h-4 w-4" checked={pProductIds.includes(p.id)} onchange={() => { pProductIds = pProductIds.includes(p.id) ? pProductIds.filter((x) => x !== p.id) : [...pProductIds, p.id] }} />
									<span class="truncate">{p.name}</span>
								</label>
							{/each}
						</div>
					</div>
				{:else if pScope === 'category'}
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Category</label>
						<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={pCategoryId}>
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
						<label class="mb-1 block text-sm font-medium text-gray-700">Code *</label>
						<input class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase" bind:value={code} placeholder="SAVE10" disabled={!!editingCoupon} required />
						{#if fieldErrors.code}<p class="mt-1 text-xs text-red-600">{fieldErrors.code}</p>{/if}
					</div>
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Type</label>
						<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={type}>
							<option value="percentage">Percentage</option>
							<option value="fixed">Fixed amount</option>
							<option value="free_shipping">Free shipping</option>
						</select>
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">{type === 'percentage' ? 'Percent' : 'Amount'}</label>
						<input type="number" step="0.01" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={value} required />
					</div>
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Min subtotal</label>
						<input type="number" step="0.01" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={minSubtotal} />
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Usage limit</label>
						<input type="number" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={usageLimit} placeholder="Unlimited" />
					</div>
					<div>
						<label class="mb-1 block text-sm font-medium text-gray-700">Status</label>
						<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={cStatus}>
							<option value="active">Active</option>
							<option value="disabled">Disabled</option>
						</select>
					</div>
				</div>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">Start date</label>
					<input type="date" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={startsAt} />
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">End date</label>
					<input type="date" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={endsAt} />
				</div>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button type="submit" loading={saving}>{editingCoupon || editingPromotion ? 'Save changes' : 'Create'}</Button>
			</div>
		</form>
	</Modal>
{/if}