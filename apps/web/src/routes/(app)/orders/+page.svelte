<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import { currency, dateTimeFull, timeAgo } from '$lib/format'
	import type { OrderListItem, PaginationMeta } from '$lib/types'

	let items = $state<OrderListItem[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let search = $state('')
	let status = $state('')
	let paymentStatus = $state('')
	let page = $state(1)

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = { page: String(page) }
			if (search) params.search = search
			if (status) params.status = status
			if (paymentStatus) params.paymentStatus = paymentStatus
			const res = await api.get<{ success: boolean; data: { items: OrderListItem[]; meta: PaginationMeta } }>(
				'/api/orders',
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

	onMount(load)

	function applyFilters() {
		page = 1
		load()
	}

	function onPage(p: number) {
		page = p
		load()
	}
</script>

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold text-gray-900">Orders</h1>
			<p class="text-sm text-gray-500">{meta.total} total</p>
		</div>
	</div>

	<Card padded={false}>
		<div class="flex flex-wrap items-center gap-3 px-5 py-3">
			<input
				class="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
				placeholder="Search order # or customer…"
				bind:value={search}
				onkeydown={(e) => e.key === 'Enter' && applyFilters()}
			/>
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={status}>
				<option value="">All statuses</option>
				<option value="pending">Pending</option>
				<option value="processing">Processing</option>
				<option value="shipped">Shipped</option>
				<option value="delivered">Delivered</option>
				<option value="cancelled">Cancelled</option>
				<option value="refunded">Refunded</option>
			</select>
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={paymentStatus}>
				<option value="">Any payment</option>
				<option value="unpaid">Unpaid</option>
				<option value="paid">Paid</option>
				<option value="partially_refunded">Partially refunded</option>
				<option value="refunded">Refunded</option>
				<option value="failed">Failed</option>
			</select>
			<Button variant="secondary" size="sm" onclick={applyFilters}>Apply</Button>
		</div>
	</Card>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded-lg bg-gray-100"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<p class="py-14 text-center text-sm text-gray-400">No orders found.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
							<th class="px-5 py-3">Order</th>
							<th class="px-3 py-3">Customer</th>
							<th class="px-3 py-3">Status</th>
							<th class="px-3 py-3">Payment</th>
							<th class="px-3 py-3">Items</th>
							<th class="px-3 py-3">Total</th>
							<th class="px-5 py-3">Placed</th>
						</tr>
					</thead>
					<tbody>
						{#each items as o (o.id)}
							<tr class="border-b border-gray-50 hover:bg-gray-50/60">
								<td class="px-5 py-3">
									<a href="/orders/{o.id}" class="inline-block py-1 font-medium text-indigo-600 hover:text-indigo-800">#{o.orderNumber}</a>
								</td>
								<td class="px-3 py-3">
									<p class="font-medium text-gray-900">{o.customerName || 'Guest'}</p>
									{#if o.customerEmail}<p class="text-xs text-gray-500">{o.customerEmail}</p>{/if}
								</td>
								<td class="px-3 py-3"><Badge label={o.status} /></td>
								<td class="px-3 py-3"><Badge label={o.paymentStatus} /></td>
								<td class="px-3 py-3 text-gray-600">{o.itemCount}</td>
								<td class="px-3 py-3 font-semibold text-gray-900">{currency(o.total, o.currency)}</td>
								<td class="px-5 py-3 text-gray-500" title={dateTimeFull(o.createdAt)}>{timeAgo(o.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		{/if}
	</Card>
</div>
