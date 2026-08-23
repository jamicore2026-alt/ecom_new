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
	import { currency, dateTime, number } from '$lib/format'
	import type { Category, PaginationMeta, Product, ProductListItem } from '$lib/types'
	import CreateEditProduct from './CreateEditProduct.svelte'
	import CategoriesManager from './CategoriesManager.svelte'

	let items = $state<ProductListItem[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let categories = $state<Category[]>([])
	let loading = $state(true)
	let saving = $state(false)

	// filters
	let search = $state('')
	let status = $state('')
	let categoryId = $state('')
	let page = $state(1)

	// selection + bulk
	let selected = $state<string[]>([])
	let bulkModal = $state(false)
	let bulkAction = $state<'set_status' | 'set_category' | 'multiply_price' | 'set_inventory'>('set_status')
	let bulkValue = $state('')
	let bulkStatus = $state('active')
	let bulkCategory = $state('')

	// create / edit
	let editOpen = $state(false)
	let editProduct = $state<Product | null>(null)
	let catModal = $state(false)

	const canWrite = () => session.can('products:write')

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = { page: String(page) }
			if (search) params.search = search
			if (status) params.status = status
			if (categoryId) params.categoryId = categoryId
			const res = await api.get<{ success: boolean; data: { items: ProductListItem[]; meta: PaginationMeta } }>(
				'/api/products',
				params
			)
			items = res.data.items
			meta = res.data.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function loadCategories() {
		try {
			const res = await api.get<{ success: boolean; data: { items: Category[] } }>('/api/categories')
			categories = res.data.items
		} catch {
			/* non-fatal */
		}
	}

	onMount(() => {
		load()
		loadCategories()
	})

	function applyFilters() {
		page = 1
		load()
	}

	function onPage(p: number) {
		page = p
		load()
	}

	function toggle(id: string) {
		if (selected.includes(id)) selected = selected.filter((s) => s !== id)
		else selected = [...selected, id]
	}

	function toggleAll() {
		if (selected.length === items.length) selected = []
		else selected = items.map((i) => i.id)
	}

	async function runBulk() {
		saving = true
		try {
			let value: string | number | null = null
			if (bulkAction === 'set_status') value = bulkStatus
			else if (bulkAction === 'set_category') value = bulkCategory || null
			else if (bulkAction === 'multiply_price') value = Number(bulkValue)
			else if (bulkAction === 'set_inventory') value = Number(bulkValue)

			await api.post<{ success: boolean }>('/api/products/bulk', {
				ids: selected,
				action: bulkAction,
				value
			})
			toast.success(`Updated ${selected.length} product(s)`)
			bulkModal = false
			selected = []
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function archiveProduct(p: ProductListItem) {
		if (!confirm(`Archive "${p.name}"?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/products/${p.id}`)
			toast.success('Product archived')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function flattenCategories(list: Category[], depth = 0): Array<Category & { depth: number }> {
		return list.flatMap((c) => [{ ...c, depth }, ...flattenCategories(c.children ?? [], depth + 1)])
	}
</script>

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold text-gray-900">Products</h1>
			<p class="text-sm text-gray-500">{meta.total} total</p>
		</div>
		<div class="flex gap-2">
			{#if canWrite()}
				<Button variant="secondary" onclick={() => (catModal = true)}>Categories</Button>
				<Button onclick={() => { editProduct = null; editOpen = true }}>Add product</Button>
			{/if}
		</div>
	</div>

	<!-- Filters -->
	<Card padded={false}>
		<div class="flex flex-wrap items-center gap-3 px-5 py-3">
			<input
				class="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
				placeholder="Search name or SKU…"
				bind:value={search}
				onkeydown={(e) => e.key === 'Enter' && applyFilters()}
			/>
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={status}>
				<option value="">All statuses</option>
				<option value="active">Active</option>
				<option value="draft">Draft</option>
				<option value="archived">Archived</option>
			</select>
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={categoryId}>
				<option value="">All categories</option>
				{#each categories as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
			<Button variant="secondary" size="sm" onclick={applyFilters}>Apply</Button>
			{#if selected.length > 0 && canWrite()}
				<span class="text-sm text-gray-500">{selected.length} selected</span>
				<Button variant="secondary" size="sm" onclick={() => (bulkModal = true)}>Bulk edit</Button>
			{/if}
		</div>
	</Card>

	<!-- Table -->
	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded-lg bg-gray-100"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<p class="py-14 text-center text-sm text-gray-400">No products found.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
							{#if canWrite()}
								<th class="w-10 px-5 py-3">
									<input type="checkbox" checked={selected.length === items.length} onchange={toggleAll} />
								</th>
							{/if}
							<th class="w-12 px-3 py-3"></th>
							<th class="px-3 py-3">Name</th>
							<th class="px-3 py-3">SKU</th>
							<th class="px-3 py-3">Price</th>
							<th class="px-3 py-3">Stock</th>
							<th class="px-3 py-3">Status</th>
							<th class="px-3 py-3">Updated</th>
							<th class="px-5 py-3 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each items as p (p.id)}
							<tr class="border-b border-gray-50 hover:bg-gray-50/60">
								{#if canWrite()}
									<td class="px-5 py-3">
										<input type="checkbox" checked={selected.includes(p.id)} onchange={() => toggle(p.id)} />
									</td>
								{/if}
								<td class="px-3 py-3">
									<div class="flex items-center gap-3">
										<div class="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
											{#if p.primaryImage}
												<img src={p.primaryImage} alt="" class="h-full w-full object-cover" />
											{/if}
										</div>
										<div>
											<a href="/products/{p.id}" class="font-medium text-indigo-600 hover:text-indigo-800">{p.name}</a>
											{#if p.category}
												<span class="ml-1 text-xs text-gray-400">· {p.category.name}</span>
											{/if}
										</div>
									</div>
								</td>
								<td class="px-3 py-3 text-gray-600">{p.sku ?? '—'}</td>
								<td class="px-3 py-3 font-medium">{currency(p.price)}</td>
								<td class="px-3 py-3">
									<span class:font-semibold={p.stock > 0} class:text-red-600={p.stock <= 0 && p.trackInventory} class:text-gray-700={p.stock > 0}>
										{number(p.stock)}
									</span>
									{#if p.variantCount > 1}
										<span class="text-xs text-gray-400"> ({p.variantCount} variants)</span>
									{/if}
								</td>
								<td class="px-3 py-3"><Badge label={p.status} /></td>
								<td class="px-3 py-3 text-gray-500">{dateTime(p.updatedAt)}</td>
								<td class="px-5 py-3 text-right">
									{#if canWrite()}
										<button class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => { editProduct = p; editOpen = true }}>
											Edit
										</button>
										<span class="mx-1 text-gray-300">|</span>
										<button class="text-xs font-medium text-red-600 hover:text-red-800" onclick={() => archiveProduct(p)}>
											Archive
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		{/if}
	</Card>
</div>

<!-- Create / Edit modal -->
{#if editOpen && canWrite()}
	<CreateEditProduct
		product={editProduct}
		categories={categories}
		onClose={() => (editOpen = false)}
		onSaved={() => {
			editOpen = false
			load()
			loadCategories()
		}}
	/>
{/if}

<!-- Bulk edit modal -->
{#if bulkModal && canWrite()}
	<Modal title="Bulk edit products" open={true} width="sm" onClose={() => (bulkModal = false)}>
		<div class="space-y-4">
			<div>
				<label class="mb-1 block text-sm font-medium text-gray-700">Action</label>
				<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={bulkAction}>
					<option value="set_status">Set status</option>
					<option value="set_category">Set category</option>
					<option value="multiply_price">Multiply price</option>
					<option value="set_inventory">Set inventory</option>
				</select>
			</div>
			{#if bulkAction === 'set_status'}
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">Status</label>
					<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={bulkStatus}>
						<option value="active">Active</option>
						<option value="draft">Draft</option>
						<option value="archived">Archived</option>
					</select>
				</div>
			{:else if bulkAction === 'set_category'}
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">Category</label>
					<select class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={bulkCategory}>
						<option value="">None</option>
						{#each categories as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>
			{:else}
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-700">
						{bulkAction === 'multiply_price' ? 'Multiplier (e.g. 1.1)' : 'New inventory count'}
					</label>
					<input
						type="number"
						class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						bind:value={bulkValue}
						placeholder={bulkAction === 'multiply_price' ? '1.1' : '50'}
					/>
				</div>
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (bulkModal = false)}>Cancel</Button>
				<Button loading={saving} onclick={runBulk}>Apply to {selected.length}</Button>
			</div>
		</div>
	</Modal>
{/if}

<!-- Categories modal -->
{#if catModal && canWrite()}
	<CategoriesManager categories={categories} onClose={() => (catModal = false)} onSaved={() => { loadCategories() }} />
{/if}
