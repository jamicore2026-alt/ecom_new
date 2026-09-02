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
	import Icon from '$lib/components/Icon.svelte'
	import { currency, dateTime, number, handleImageError } from '$lib/format'
	import { t } from '$lib/i18n'
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

	// csv
	let exporting = $state(false)
	let importing = $state(false)
	let importOpen = $state(false)
	let importFile = $state<File | null>(null)
	let importResult = $state<{ created: number; updated: number; failed: number; errors: Array<{ line: number; message: string }> } | null>(null)

	const canWrite = () => session.can('products:write')

	async function exportCsv() {
		exporting = true
		try {
			await api.download('/api/products/export', `products-${new Date().toISOString().slice(0, 10)}.csv`)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			exporting = false
		}
	}

	async function runImport() {
		if (!importFile) return
		importing = true
		try {
			const form = new FormData()
			form.append('file', importFile, importFile.name)
			const res = await api.upload<{ success: boolean; data: { created: number; updated: number; failed: number; errors: Array<{ line: number; message: string }> } }>(
				'/api/products/import',
				form
			)
			importResult = res.data
			toast.success(`Imported ${res.data.created} created, ${res.data.updated} updated`)
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			importing = false
		}
	}

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

<svelte:head>
	<title>{t('products.title')} — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">{t('products.title')}</h1>
			<p class="mt-1 text-body-sm text-secondary">{meta.total} {t('common.total')}</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button variant="secondary" loading={exporting} onclick={exportCsv}>{t('products.exportCsv')}</Button>
			{#if canWrite()}
				<Button variant="secondary" onclick={() => { importResult = null; importFile = null; importOpen = true }}>{t('products.importCsv')}</Button>
				<Button variant="secondary" onclick={() => (catModal = true)}>{t('products.categories')}</Button>
				<Button onclick={() => { editProduct = null; editOpen = true }}><Icon name="add" size="text-[18px]" /> {t('products.new')}</Button>
			{/if}
		</div>
	</div>

	<!-- Filters -->
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-3">
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-[200px] flex-1">
				<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
					<Icon name="search" size="text-[18px]" />
				</div>
				<input
					class="field pl-9"
					placeholder={t('products.searchPlaceholder')}
					bind:value={search}
					onkeydown={(e) => e.key === 'Enter' && applyFilters()}
				/>
			</div>
			<select class="field w-auto" bind:value={status}>
				<option value="">{t('products.allStatuses')}</option>
				<option value="active">{t('products.available')}</option>
				<option value="draft">Draft</option>
				<option value="archived">{t('products.archived')}</option>
			</select>
			<select class="field w-auto" bind:value={categoryId}>
				<option value="">{t('products.allCategories')}</option>
				{#each categories as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
			<Button variant="secondary" size="sm" onclick={applyFilters}>Apply</Button>
			{#if selected.length > 0 && canWrite()}
				<span class="text-sm text-secondary">{selected.length} selected</span>
				<Button variant="secondary" size="sm" onclick={() => (bulkModal = true)}>Bulk edit</Button>
			{/if}
		</div>
	</div>

	<!-- Table -->
	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="inventory_2" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">{t('products.noProducts')}</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							{#if canWrite()}
								<th class="w-10 px-table-cell-x py-table-cell-y font-semibold">
									<input type="checkbox" class="field-check" checked={selected.length === items.length} onchange={toggleAll} />
								</th>
							{/if}
							<th class="w-12 px-table-cell-x py-table-cell-y font-semibold"></th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Name</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">SKU</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Price</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Stock</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Updated</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each items as p (p.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								{#if canWrite()}
									<td class="px-table-cell-x py-table-cell-y">
										<input type="checkbox" class="field-check" checked={selected.includes(p.id)} onchange={() => toggle(p.id)} />
									</td>
								{/if}
								<td class="px-table-cell-x py-table-cell-y">
									<div class="flex items-center gap-3">
										<div class="h-9 w-9 shrink-0 overflow-hidden rounded border border-outline-variant bg-surface-container-low">
											{#if p.primaryImage}
												<img src={p.primaryImage} alt="" class="h-full w-full object-cover" onerror={handleImageError} />
											{/if}
										</div>
										<div>
											<a href="/products/{p.id}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">{p.name}</a>
											{#if p.category}
												<span class="ml-1 text-xs text-outline">· {p.category.name}</span>
											{/if}
										</div>
									</div>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{p.sku ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(p.price)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<span class:font-semibold={p.stock > 0} class:text-error={p.stock <= 0 && p.trackInventory} class:text-on-surface-variant={p.stock > 0}>
										{number(p.stock)}
									</span>
									{#if p.variantCount > 1}
										<span class="text-xs text-outline"> ({p.variantCount} variants)</span>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={p.status} /></td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(p.updatedAt)}</td>
								<td class="px-table-cell-x py-table-cell-y text-right">
									{#if canWrite()}
										<button class="inline-block rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => { editProduct = p; editOpen = true }}>
											Edit
										</button>
										<button class="inline-block rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => archiveProduct(p)}>
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
				<label for="bulk-action" class="field-label">Action</label>
				<select id="bulk-action" class="field" bind:value={bulkAction}>
					<option value="set_status">Set status</option>
					<option value="set_category">Set category</option>
					<option value="multiply_price">Multiply price</option>
					<option value="set_inventory">Set inventory</option>
				</select>
			</div>
			{#if bulkAction === 'set_status'}
				<div>
					<label for="bulk-status" class="field-label">Status</label>
					<select id="bulk-status" class="field" bind:value={bulkStatus}>
						<option value="active">Active</option>
						<option value="draft">Draft</option>
						<option value="archived">Archived</option>
					</select>
				</div>
			{:else if bulkAction === 'set_category'}
				<div>
					<label for="bulk-category" class="field-label">Category</label>
					<select id="bulk-category" class="field" bind:value={bulkCategory}>
						<option value="">None</option>
						{#each categories as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>
			{:else}
				<div>
					<label for="bulk-value" class="field-label">
						{bulkAction === 'multiply_price' ? 'Multiplier (e.g. 1.1)' : 'New inventory count'}
					</label>
					<input
						id="bulk-value"
						type="number"
						class="field"
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

<!-- Import CSV modal -->
{#if importOpen && canWrite()}
	<Modal title="Import products from CSV" open={true} width="sm" onClose={() => (importOpen = false)}>
		<div class="space-y-4">
			<p class="text-sm text-secondary">
				One row per variant. Existing products are matched by SKU and updated — nothing is deleted.
			</p>
			<input
				type="file"
				accept=".csv,text/csv"
				class="field py-2 file:mr-3 file:rounded file:border-0 file:bg-primary-fixed file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-on-primary-fixed"
				onchange={(e) => {
					const files = (e.currentTarget as HTMLInputElement).files
					importFile = files && files.length > 0 ? files[0] : null
					importResult = null
				}}
			/>
			{#if importResult}
				<div class="rounded border border-outline-variant bg-surface-container-low p-3 text-sm">
					<p>
						<span class="font-semibold text-success">{importResult.created} created</span> ·
						<span class="font-semibold text-primary">{importResult.updated} updated</span> ·
						<span class="font-semibold {importResult.failed > 0 ? 'text-error' : 'text-secondary'}">{importResult.failed} failed</span>
					</p>
					{#if importResult.errors.length > 0}
						<ul class="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-error">
							{#each importResult.errors as err (err.line)}
								<li>Line {err.line}: {err.message}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (importOpen = false)}>Close</Button>
				<Button loading={importing} disabled={!importFile} onclick={runImport}>Import</Button>
			</div>
		</div>
	</Modal>
{/if}