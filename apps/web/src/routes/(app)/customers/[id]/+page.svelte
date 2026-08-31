<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import Icon from '$lib/components/Icon.svelte'
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

	const stats = [
		{ label: 'Total spent', value: () => currency(customer!.totalSpent) },
		{ label: 'Net spent', value: () => currency(customer!.netSpent) },
		{ label: 'Orders', value: () => number(customer!.ordersCount) },
		{ label: 'Avg order value', value: () => currency(customer!.avgOrderValue) }
	]
</script>

<svelte:head>
	<title>{customer?.firstName ?? ''} {customer?.lastName ?? ''} — Merchant OS</title>
</svelte:head>

{#if loading}
	<div class="h-40 animate-pulse rounded bg-surface-container"></div>
{:else if customer}
	<div class="space-y-6">
		<!-- Page header -->
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div>
				<a href="/customers" class="inline-flex items-center gap-1 py-1 text-body-sm text-secondary hover:text-primary">
					<Icon name="arrow_back" size="text-[16px]" />
					Customers
				</a>
				<h1 class="mt-1 font-display text-display text-on-surface">{customer.firstName ?? ''} {customer.lastName ?? ''}</h1>
				<p class="mt-1 text-body-sm text-secondary">{customer.email}</p>
			</div>
			{#if customer.tags.length}
				<div class="flex flex-wrap gap-1.5">
					{#each customer.tags as t (t)}
						<span class="inline-block rounded-full border border-outline-variant bg-surface-container-low px-2.5 py-1 text-xs text-on-surface-variant">{t}</span>
					{/each}
				</div>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			{#each stats as s}
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4 transition-colors hover:border-primary">
					<span class="font-mono-label text-mono-label uppercase tracking-wider text-secondary">{s.label}</span>
					<span class="mt-1.5 block font-display text-[24px] font-semibold tracking-tight text-on-surface">{s.value()}</span>
				</div>
			{/each}
		</div>

		<div class="grid gap-6 lg:grid-cols-3">
			<Card title="Details">
				<dl class="space-y-2.5 text-sm">
					<div class="flex justify-between gap-4"><dt class="text-secondary">Email</dt><dd class="text-right font-medium text-on-surface">{customer.email}</dd></div>
					<div class="flex justify-between gap-4"><dt class="text-secondary">Phone</dt><dd class="font-medium text-on-surface">{customer.phone ?? '—'}</dd></div>
					<div class="flex justify-between gap-4"><dt class="text-secondary">Refunds</dt><dd class="text-error">−{currency(customer.refundTotal)}</dd></div>
					<div class="flex justify-between gap-4"><dt class="text-secondary">Last order</dt><dd class="text-on-surface-variant">{(customer.lastOrderAt && dateTimeFull(customer.lastOrderAt)) || '—'}</dd></div>
					<div class="flex justify-between gap-4"><dt class="text-secondary">Joined</dt><dd class="text-on-surface-variant">{dateTimeFull(customer.createdAt)}</dd></div>
				</dl>
			</Card>

			<Card title={`Order history (${meta.total})`} padded={false} class="lg:col-span-2">
				{#if orders.length === 0}
					<div class="flex flex-col items-center gap-2 py-12 text-center">
						<Icon name="receipt_long" size="text-[28px]" class="text-outline" />
						<p class="text-sm text-secondary">No orders yet.</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
									<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Payment</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Total</th>
									<th class="px-table-cell-x py-table-cell-y font-semibold">Placed</th>
								</tr>
							</thead>
							<tbody>
								{#each orders as o (o.id)}
									<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
										<td class="px-table-cell-x py-table-cell-y">
											<a href="/orders/{o.id}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">#{o.orderNumber}</a>
										</td>
										<td class="px-table-cell-x py-table-cell-y"><Badge label={o.status} /></td>
										<td class="px-table-cell-x py-table-cell-y"><Badge label={o.paymentStatus} /></td>
										<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(o.total, o.currency)}</td>
										<td class="px-table-cell-x py-table-cell-y text-secondary" title={dateTimeFull(o.createdAt)}>{timeAgo(o.createdAt)}</td>
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
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-8 text-center text-sm text-secondary">
		Customer not found.
	</div>
{/if}