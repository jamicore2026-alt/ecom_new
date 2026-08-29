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
	import { currency, dateTime, dateTimeFull, number, titleCase } from '$lib/format'
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

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold text-gray-900">Inventory</h1>
			<p class="text-sm text-gray-500">{meta.total} variants</p>
		</div>
	</div>

	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
			{#each tabs as t (t.id)}
				<button
					class="rounded-md px-3 py-1.5 text-sm font-medium"
					class:bg-indigo-600={tab === t.id}
					class:text-white={tab === t.id}
					class:text-gray-600={tab !== t.id}
					class:hover:bg-gray-100={tab !== t.id}
					onclick={() => switchTab(t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>

		{#if tab === 'all'}
			<div class="flex gap-2">
				<input
					class="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
					placeholder="Search product or SKU…"
					bind:value={search}
					onkeydown={(e) => e.key === 'Enter' && load()}
				/>
				<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={status}>
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
					<div class="h-12 animate-pulse rounded-lg bg-gray-100"></div>
				{/each}
			</div>
		{:else if (tab === 'history' ? history.length : items.length) === 0}
			<p class="py-14 text-center text-sm text-gray-400">Nothing here.</p>
		{:else if tab === 'history'}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
							<th class="px-5 py-3">Product</th>
							<th class="px-3 py-3">Variant</th>
							<th class="px-3 py-3">Change</th>
							<th class="px-3 py-3">Before</th>
							<th class="px-3 py-3">After</th>
							<th class="px-3 py-3">Reason</th>
							<th class="px-5 py-3">When</th>
						</tr>
					</thead>
					<tbody>
						{#each history as h (h.id)}
							<tr class="border-b border-gray-50 hover:bg-gray-50/60">
								<td class="px-5 py-3">
									<a href="/products/{h.productId}" class="font-medium text-indigo-600 hover:text-indigo-800">{h.productName}</a>
								</td>
								<td class="px-3 py-3 text-gray-600">{h.sku ?? '—'}</td>
								<td class="px-3 py-3 font-semibold" class:text-emerald-600={h.change > 0} class:text-red-600={h.change < 0}>
									{h.change > 0 ? `+${h.change}` : h.change}
								</td>
								<td class="px-3 py-3 text-gray-600">{number(h.beforeValue)}</td>
								<td class="px-3 py-3 font-medium">{number(h.afterValue)}</td>
								<td class="px-3 py-3">
									<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{titleCase(h.reason)}</span>
								</td>
								<td class="px-5 py-3 text-gray-500" title={dateTimeFull(h.createdAt)}>{dateTime(h.createdAt)}</td>
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
							<th class="px-5 py-3">Product</th>
							<th class="px-3 py-3">Variant</th>
							<th class="px-3 py-3">SKU</th>
							<th class="px-3 py-3">Price</th>
							<th class="px-3 py-3">Inventory</th>
							<th class="px-3 py-3">Status</th>
							{#if canWrite()}
								<th class="px-5 py-3 text-right">Actions</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each items as it (it.id)}
							<tr class="border-b border-gray-50 hover:bg-gray-50/60">
								<td class="px-5 py-3">
									<a href="/products/{it.productId}" class="font-medium text-indigo-600 hover:text-indigo-800">{it.productName}</a>
									{#if it.categoryName}<span class="ml-1 text-xs text-gray-400">· {it.categoryName}</span>{/if}
								</td>
								<td class="px-3 py-3 text-gray-600">
									{#if it.image}
										<img src={it.image} alt="" class="mr-2 inline h-7 w-7 rounded object-cover" />
									{/if}
									{#if Object.keys(it.optionValues ?? {}).length}
										{Object.entries(it.optionValues).map(([k, v]) => `${k}: ${v}`).join(', ')}
									{:else}
										<span class="text-gray-400">Default</span>
									{/if}
								</td>
								<td class="px-3 py-3 text-gray-600">{it.sku ?? '—'}</td>
								<td class="px-3 py-3 font-medium">{currency(it.price)}</td>
								<td class="px-3 py-3">
									<span
										class:font-semibold={true}
										class:text-red-600={it.inventory === 0}
										class:text-amber-600={it.inventory > 0 && it.trackInventory && it.inventory <= it.lowStockThreshold}
									>
										{number(it.inventory)}
									</span>
									{#if it.trackInventory && it.inventory <= it.lowStockThreshold}
										<span class="ml-1 text-xs text-gray-400">(threshold {it.lowStockThreshold})</span>
									{/if}
								</td>
								<td class="px-3 py-3"><Badge label={it.productStatus} /></td>
								{#if canWrite()}
									<td class="px-5 py-3 text-right">
										<button class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => { adjustTarget = it; adjustChange = '1'; adjustReason = 'adjustment' }}>
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
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault()
				applyAdjust()
			}}
		>
			<p class="text-sm text-gray-500">Current stock: <span class="font-semibold text-gray-900">{number(adjustTarget.inventory)}</span></p>
			<div>
				<label for="adjust-change" class="mb-1 block text-sm font-medium text-gray-700">Change (+ add / − remove)</label>
				<input id="adjust-change" type="number" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={adjustChange} required />
			</div>
			<div>
				<label for="adjust-reason" class="mb-1 block text-sm font-medium text-gray-700">Reason</label>
				<select id="adjust-reason" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={adjustReason}>
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
