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
	import { currency, dateTime, dateTimeFull, number, titleCase, handleImageError } from '$lib/format'
	import type { InventoryHistoryRow, InventoryRow, PaginationMeta } from '$lib/types'

	type Tab = 'all' | 'low' | 'out' | 'history'
	let tab = $state<Tab>('all')

	let items = $state<InventoryRow[]>([])
	let history = $state<InventoryHistoryRow[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let search = $state('')
	let status = $state('')
	let page = $state(1)

	let adjustTarget = $state<InventoryRow | null>(null)
	let adjustChange = $state('1')
	let adjustReason = $state<'adjustment' | 'purchase' | 'return' | 'sale'>('adjustment')
	let adjusting = $state(false)

	const canWrite = () => session.can('inventory:write')

	function params(extra: Record<string, string> = {}): Record<string, string> {
		return { page: String(page), ...extra }
	}

	async function load() {
		loading = true
		try {
			if (tab === 'history') {
				const res = await api.get<{ success: boolean; data: { items: InventoryHistoryRow[]; meta: PaginationMeta } }>(
					'/api/inventory/history',
					params()
				)
				history = res.data.items
				meta = res.data.meta
			} else {
				const path =
					tab === 'low' ? '/api/inventory/low-stock' : tab === 'out' ? '/api/inventory/out-of-stock' : '/api/inventory'
				const res = await api.get<{ success: boolean; data: { items: InventoryRow[]; meta: PaginationMeta } }>(
					path,
					params(tab === 'all' ? { ...(search ? { search } : {}), ...(status ? { status } : {}) } : {})
				)
				items = res.data.items
				meta = res.data.meta
			}
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function switchTab(t: Tab) {
		tab = t
		page = 1
		load()
	}

	function onPage(p: number) {
		page = p
		load()
	}

	async function applyAdjust() {
		if (!adjustTarget) return
		adjusting = true
		try {
			await api.post<{ success: boolean }>(`/api/inventory/${adjustTarget.id}/adjust`, {
				change: Number(adjustChange),
				reason: adjustReason
			})
			toast.success('Inventory adjusted')
			adjustTarget = null
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			adjusting = false
		}
	}

	const tabs: Array<{ id: Tab; label: string }> = [
		{ id: 'all', label: 'All' },
		{ id: 'low', label: 'Low stock' },
		{ id: 'out', label: 'Out of stock' },
		{ id: 'history', label: 'History' }
	]
</script>

<svelte:head>
	<title>Inventory — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8">
		<h1 class="font-display text-display text-on-surface">Inventory</h1>
		<p class="mt-1 text-body-sm text-secondary">{meta.total} variants</p>
	</div>

	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex w-fit gap-1 rounded border border-outline-variant bg-surface-container-lowest p-1">
			{#each tabs as t (t.id)}
				<button
					class="rounded px-3 py-1.5 text-sm font-medium transition-colors {tab === t.id ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}"
					onclick={() => switchTab(t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>

		{#if tab === 'all'}
			<div class="flex flex-wrap gap-2">
				<div class="relative min-w-[180px]">
					<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
						<Icon name="search" size="text-[16px]" />
					</div>
					<input class="field pl-9" placeholder="Search product or SKU…" bind:value={search} onkeydown={(e) => e.key === 'Enter' && load()} />
				</div>
				<select class="field w-auto" bind:value={status}>
					<option value="">All statuses</option>
					<option value="active">Active</option>
					<option value="draft">Draft</option>
					<option value="archived">Archived</option>
				</select>
				<Button variant="secondary" size="sm" onclick={load}>Apply</Button>
			</div>
		{/if}
	</div>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if (tab === 'history' ? history.length : items.length) === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="inventory_2" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">Nothing here.</p>
			</div>
		{:else if tab === 'history'}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Product</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Variant</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Change</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Before</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">After</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Reason</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">When</th>
						</tr>
					</thead>
					<tbody>
						{#each history as h (h.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<a href="/products/{h.productId}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">{h.productName}</a>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{h.sku ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label font-semibold" class:text-success={h.change > 0} class:text-error={h.change < 0}>
									{h.change > 0 ? `+${h.change}` : h.change}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(h.beforeValue)}</td>
								<td class="px-table-cell-x py-table-cell-y font-medium text-on-surface">{number(h.afterValue)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<span class="rounded-full bg-secondary/10 px-2 py-0.5 text-xs text-secondary">{titleCase(h.reason)}</span>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary" title={dateTimeFull(h.createdAt)}>{dateTime(h.createdAt)}</td>
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
							<th class="px-table-cell-x py-table-cell-y font-semibold">Product</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Variant</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">SKU</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Price</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Inventory</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							{#if canWrite()}
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each items as it (it.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<a href="/products/{it.productId}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">{it.productName}</a>
									{#if it.categoryName}<span class="ml-1 text-xs text-outline">· {it.categoryName}</span>{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">
									{#if it.image}
										<img src={it.image} alt="" class="mr-2 inline h-7 w-7 rounded object-cover" onerror={handleImageError} />
									{/if}
									{#if Object.keys(it.optionValues ?? {}).length}
										{Object.entries(it.optionValues).map(([k, v]) => `${k}: ${v}`).join(', ')}
									{:else}
										<span class="text-outline">Default</span>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{it.sku ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(it.price)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<span
										class:font-semibold={true}
										class:text-error={it.inventory === 0}
										class:text-warning={it.inventory > 0 && it.trackInventory && it.inventory <= it.lowStockThreshold}
									>
										{number(it.inventory)}
									</span>
									{#if it.trackInventory && it.inventory <= it.lowStockThreshold}
										<span class="ml-1 text-xs text-outline">(threshold {it.lowStockThreshold})</span>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={it.productStatus} /></td>
								{#if canWrite()}
									<td class="px-table-cell-x py-table-cell-y text-right">
										<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => { adjustTarget = it; adjustChange = '1'; adjustReason = 'adjustment' }}>
											Adjust
										</button>
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

{#if adjustTarget && canWrite()}
	<Modal title={`Adjust inventory — ${adjustTarget.productName}`} open={true} width="sm" onClose={() => (adjustTarget = null)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); applyAdjust() }}>
			<p class="text-sm text-secondary">Current stock: <span class="font-semibold text-on-surface">{number(adjustTarget.inventory)}</span></p>
			<div>
				<label for="adjust-change" class="field-label">Change (+ add / − remove)</label>
				<input id="adjust-change" type="number" class="field" bind:value={adjustChange} required />
			</div>
			<div>
				<label for="adjust-reason" class="field-label">Reason</label>
				<select id="adjust-reason" class="field" bind:value={adjustReason}>
					<option value="adjustment">Adjustment</option>
					<option value="purchase">Purchase</option>
					<option value="return">Return</option>
					<option value="sale">Sale</option>
				</select>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (adjustTarget = null)}>Cancel</Button>
				<Button type="submit" loading={adjusting}>Apply</Button>
			</div>
		</form>
	</Modal>
{/if}
