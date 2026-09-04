<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import { currency, dateTimeFull } from '$lib/format'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import type { Invoice, PaginationMeta } from '$lib/types'

	let items = $state<Invoice[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	const canRead = () => session.can('orders.read')

	async function load(p = 1) {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Invoice[]; meta: PaginationMeta } }>(
				'/api/invoices',
				{ page: p, limit: meta.limit }
			)
			items = res.data.items
			meta = res.data.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(() => load())

	function onPage(p: number) {
		load(p)
	}
</script>

<svelte:head>
	<title>Invoices — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Invoices</h1>
			<p class="mt-1 text-body-sm text-secondary">{meta.total} total</p>
		</div>
	</div>

	{#if !canRead()}
		<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
			You need the <span class="font-semibold text-on-surface">orders.read</span> permission to view this.
		</div>
	{:else if loading}
		<div class="space-y-2 p-5">
			{#each Array(6) as _}
				<div class="h-12 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if items.length === 0}
		<Card>
			<div class="flex flex-col items-center gap-3 py-16 text-center">
				<Icon name="receipt_long" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No invoices yet.</p>
			</div>
		</Card>
	{:else}
		<Card padded={false}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Number</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Type</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Total</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Date</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
						</tr>
					</thead>
					<tbody>
						{#each items as inv (inv.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{inv.invoiceNumber}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{inv.invoiceType === 'credit_note' ? 'Credit Note' : 'Invoice'}</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={inv.status} /></td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(inv.total)}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTimeFull(inv.invoiceDate)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<a href="/orders/{inv.orderId}" class="text-primary hover:underline">{inv.orderId.slice(0, 8)}</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		</Card>
	{/if}
</div>
