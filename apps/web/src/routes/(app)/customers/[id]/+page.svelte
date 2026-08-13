<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import { currency, dateTimeFull, number, timeAgo } from '$lib/format'
	import type { CustomerDetail, OrderDetail, PaginationMeta } from '$lib/types'
	import { page } from '$app/state'

	let customer = $state<CustomerDetail | null>(null)
	let orders = $state<OrderDetail[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)
	let id = $derived(page.params.id)
	let orderPage = $state(1)

	async function load() {
		loading = true
		try {
			const [c, o] = await Promise.all([
				api.get<{ success: boolean; data: CustomerDetail }>(`/api/customers/${id}`),
				api.get<{ success: boolean; data: { items: OrderDetail[]; meta: PaginationMeta } }>(
					`/api/customers/${id}/orders`,
					{ page: String(orderPage) }
				)
			])
			customer = c.data
			orders = o.data.items
			meta = o.data.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	$effect(() => {
		load()
	})
</script>

{#if loading}
	<div class="h-40 animate-pulse rounded-xl bg-gray-200"></div>
{:else if customer}
	<div class="space-y-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<a href="/customers" class="text-sm text-gray-500 hover:text-gray-700">← Customers</a>
				<h1 class="text-xl font-bold text-gray-900">{customer.firstName ?? ''} {customer.lastName ?? ''}</h1>
				<p class="text-sm text-gray-500">{customer.email}</p>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<div class="rounded-xl border border-gray-200 bg-white p-4">
				<p class="text-xs text-gray-500">Total spent</p>
				<p class="mt-1 text-xl font-bold text-gray-900">{currency(customer.totalSpent)}</p>
			</div>
			<div class="rounded-xl border border-gray-200 bg-white p-4">
				<p class="text-xs text-gray-500">Net spent</p>
				<p class="mt-1 text-xl font-bold text-gray-900">{currency(customer.netSpent)}</p>
			</div>
			<div class="rounded-xl border border-gray-200 bg-white p-4">
				<p class="text-xs text-gray-500">Orders</p>
				<p class="mt-1 text-xl font-bold text-gray-900">{number(customer.ordersCount)}</p>
			</div>
			<div class="rounded-xl border border-gray-200 bg-white p-4">
				<p class="text-xs text-gray-500">Avg order value</p>
				<p class="mt-1 text-xl font-bold text-gray-900">{currency(customer.avgOrderValue)}</p>
			</div>
		</div>

		<div class="grid gap-5 lg:grid-cols-3">
			<Card title="Details">
				<dl class="space-y-2 text-sm">
					<div class="flex justify-between"><dt class="text-gray-500">Email</dt><dd class="font-medium">{customer.email}</dd></div>
					<div class="flex justify-between"><dt class="text-gray-500">Phone</dt><dd class="font-medium">{customer.phone ?? '—'}</dd></div>
					<div class="flex justify-between"><dt class="text-gray-500">Refunds</dt><dd class="text-red-600">−{currency(customer.refundTotal)}</dd></div>
					<div class="flex justify-between"><dt class="text-gray-500">Last order</dt><dd>{(customer.lastOrderAt && dateTimeFull(customer.lastOrderAt)) || '—'}</dd></div>
					<div class="flex justify-between"><dt class="text-gray-500">Joined</dt><dd>{dateTimeFull(customer.createdAt)}</dd></div>
					<div class="flex justify-between"><dt class="text-gray-500">Tags</dt>
						<dd>
							{#if customer.tags.length}
								{#each customer.tags as t (t)}<span class="mr-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{t}</span>{/each}
							{:else}—{/if}
						</dd>
					</div>
				</dl>
			</Card>

			<Card title={`Order history (${meta.total})`} padded={false}>
				{#if orders.length === 0}
					<p class="py-12 text-center text-sm text-gray-400">No orders yet.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
									<th class="px-5 py-3">Order</th>
									<th class="px-3 py-3">Status</th>
									<th class="px-3 py-3">Payment</th>
									<th class="px-3 py-3">Total</th>
									<th class="px-5 py-3">Placed</th>
								</tr>
							</thead>
							<tbody>
								{#each orders as o (o.id)}
									<tr class="border-b border-gray-50 hover:bg-gray-50/60">
										<td class="px-5 py-3">
											<a href="/orders/{o.id}" class="font-medium text-indigo-600 hover:text-indigo-800">#{o.orderNumber}</a>
										</td>
										<td class="px-3 py-3"><Badge label={o.status} /></td>
										<td class="px-3 py-3"><Badge label={o.paymentStatus} /></td>
										<td class="px-3 py-3 font-medium">{currency(o.total, o.currency)}</td>
										<td class="px-5 py-3 text-gray-500" title={dateTimeFull(o.createdAt)}>{timeAgo(o.createdAt)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<Pagination {meta} onPage={(p) => { orderPage = p; load() }} />
				{/if}
			</Card>
		</div>
	</div>
{:else}
	<p class="text-sm text-gray-500">Customer not found.</p>
{/if}