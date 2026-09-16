<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { currency, dateTime, dateTimeFull, timeAgo } from '$lib/format'
	import { t } from '$lib/i18n'
	import { session } from '$lib/session.svelte'
	import type { OrderListItem, PaginationMeta } from '$lib/types'

	interface ReturnRow {
		id: string
		orderId: string
		orderItemId: string | null
		quantity: number
		amount: number
		reason: string | null
		status: string
		createdAt: string
		orderNumber: string
	}

	interface RefundRow {
		id: string
		orderId: string
		returnId: string | null
		amount: number
		method: string
		status: string
		createdAt: string
		orderNumber: string
	}

	let items = $state<OrderListItem[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let returns = $state<ReturnRow[]>([])
	let refunds = $state<RefundRow[]>([])
	let rrLoading = $state(true)
	let showReturnsRefunds = $state(true)
	let exporting = $state(false)

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

	async function loadReturnsRefunds() {
		rrLoading = true
		try {
			const [rr, rf] = await Promise.all([
				api.get<{ success: boolean; data: ReturnRow[] }>('/api/returns'),
				api.get<{ success: boolean; data: RefundRow[] }>('/api/refunds')
			])
			returns = rr.data
			refunds = rf.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			rrLoading = false
		}
	}

	async function exportCsv() {
		exporting = true
		try {
			await api.download('/api/orders/export', 'orders.csv')
			toast.success('Orders exported')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			exporting = false
		}
	}

	onMount(() => {
		load()
		loadReturnsRefunds()
	})

	function applyFilters() {
		page = 1
		load()
	}

	function onPage(p: number) {
		page = p
		load()
	}
</script>

<svelte:head>
	<title>{t('orders.title')} — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">{t('orders.title')}</h1>
			<p class="mt-1 text-body-sm text-secondary">{meta.total} {t('common.total')}</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button variant="secondary" size="sm" onclick={exportCsv} loading={exporting}>
				<Icon name="download" size="text-[16px]" />
				Export CSV
			</Button>
		</div>
	</div>

	<div class="rounded border border-outline-variant bg-surface-container-lowest p-3">
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-[220px] flex-1">
				<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
					<Icon name="search" size="text-[18px]" />
				</div>
				<input
					class="w-full rounded border border-outline-variant bg-surface-container-lowest py-2 pl-9 pr-3 text-sm text-on-surface placeholder:text-secondary focus:outline-2 focus:outline-primary"
					placeholder="Search order # or customer…"
					aria-label="Search order # or customer"
					bind:value={search}
					onkeydown={(e) => e.key === 'Enter' && applyFilters()}
				/>
			</div>
			<select class="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary" bind:value={status} aria-label="Filter by status">
				<option value="">All statuses</option>
				<option value="pending">Pending</option>
				<option value="processing">Processing</option>
				<option value="shipped">Shipped</option>
				<option value="delivered">Delivered</option>
				<option value="cancelled">Cancelled</option>
				<option value="refunded">Refunded</option>
			</select>
			<select class="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary" bind:value={paymentStatus} aria-label="Filter by payment status">
				<option value="">Any payment</option>
				<option value="unpaid">Unpaid</option>
				<option value="paid">Paid</option>
				<option value="partially_refunded">Partially refunded</option>
				<option value="refunded">Refunded</option>
				<option value="failed">Failed</option>
			</select>
			<Button variant="secondary" size="sm" onclick={applyFilters}>Apply</Button>
		</div>
	</div>

	<h2 class="sr-only">{t('orders.list')}</h2>
	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="receipt_long" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No orders found.</p>
			</div>
		{:else}
			<div class="divide-y divide-outline-variant/60 md:hidden">
				{#each items as o (o.id)}
					<a href="/orders/{o.id}" class="block px-4 py-3 transition-colors hover:bg-surface-container-low">
						<div class="flex items-center justify-between gap-3">
							<p class="font-medium text-primary">#{o.orderNumber}</p>
							<span class="font-mono-label text-mono-label text-on-surface">{currency(o.total, o.currency)}</span>
						</div>
						<div class="mt-1 flex items-center justify-between gap-3">
							<p class="text-xs text-secondary">{o.customerName || 'Guest'}</p>
							<span class="flex items-center gap-2">
								<Badge label={o.status} />
								<Badge label={o.paymentStatus} />
							</span>
						</div>
						<p class="mt-0.5 text-xs text-secondary">{o.itemCount} items · {timeAgo(o.createdAt)}</p>
					</a>
				{/each}
			</div>
			<div class="hidden overflow-x-auto md:block">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Customer</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Payment</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Items</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Total</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Placed</th>
						</tr>
					</thead>
					<tbody>
						{#each items as o (o.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<a href="/orders/{o.id}" class="inline-flex min-h-11 items-center rounded font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">#{o.orderNumber}</a>
								</td>
								<td class="px-table-cell-x py-table-cell-y">
									<p class="font-medium text-on-surface">{o.customerName || 'Guest'}</p>
									{#if o.customerEmail}<p class="text-xs text-secondary">{o.customerEmail}</p>{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={o.status} /></td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={o.paymentStatus} /></td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{o.itemCount}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(o.total, o.currency)}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary" title={dateTimeFull(o.createdAt)}>{timeAgo(o.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		{/if}
	</Card>

	<Card>
		<div class="flex items-center justify-between gap-3">
			<h2 class="font-display text-xl text-on-surface">Returns & Refunds</h2>
			<Button variant="ghost" size="sm" onclick={() => (showReturnsRefunds = !showReturnsRefunds)}>
				<Icon name={showReturnsRefunds ? 'expand_less' : 'expand_more'} size="text-[16px]" />
				{showReturnsRefunds ? 'Hide' : 'Show'}
			</Button>
		</div>
		{#if showReturnsRefunds}
			<div class="mt-4">
				{#if rrLoading}
					<div class="space-y-2">
						{#each Array(4) as _}
							<div class="h-10 animate-pulse rounded bg-surface-container"></div>
						{/each}
					</div>
				{:else}
					<div class="grid gap-6 lg:grid-cols-2">
						<div>
							<h3 class="mb-2 text-sm font-semibold text-on-surface">Returns ({returns.length})</h3>
							{#if returns.length === 0}
								<p class="py-6 text-center text-sm text-secondary">No returns.</p>
							{:else}
								<div class="overflow-x-auto">
									<table class="w-full text-left text-sm">
										<thead>
											<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
												<th class="px-table-cell-x py-table-cell-y font-semibold">Ref</th>
												<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
												<th class="px-table-cell-x py-table-cell-y font-semibold">Amount</th>
												<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
												<th class="px-table-cell-x py-table-cell-y font-semibold">Date</th>
											</tr>
										</thead>
										<tbody>
											{#each returns as r (r.id)}
												<tr class="border-b border-outline-variant/60">
													<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">#R-{r.id.slice(0, 8)}</td>
													<td class="px-table-cell-x py-table-cell-y">
														<a href="/orders/{r.orderId}" class="inline-flex min-h-11 items-center rounded font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">#{r.orderNumber}</a>
													</td>
													<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{r.amount != null ? currency(r.amount, session.merchant?.currency) : '—'}</td>
													<td class="px-table-cell-x py-table-cell-y"><Badge label={r.status} /></td>
													<td class="px-table-cell-x py-table-cell-y text-secondary" title={dateTimeFull(r.createdAt)}>{dateTime(r.createdAt)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
						</div>
						<div>
							<h3 class="mb-2 text-sm font-semibold text-on-surface">Refunds ({refunds.length})</h3>
							{#if refunds.length === 0}
								<p class="py-6 text-center text-sm text-secondary">No refunds.</p>
							{:else}
								<div class="overflow-x-auto">
									<table class="w-full text-left text-sm">
										<thead>
											<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
												<th class="px-table-cell-x py-table-cell-y font-semibold">Ref</th>
												<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
												<th class="px-table-cell-x py-table-cell-y font-semibold">Amount</th>
												<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
												<th class="px-table-cell-x py-table-cell-y font-semibold">Date</th>
											</tr>
										</thead>
										<tbody>
											{#each refunds as r (r.id)}
												<tr class="border-b border-outline-variant/60">
													<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">#RF-{r.id.slice(0, 8)}</td>
													<td class="px-table-cell-x py-table-cell-y">
														<a href="/orders/{r.orderId}" class="inline-flex min-h-11 items-center rounded font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">#{r.orderNumber}</a>
													</td>
													<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(r.amount, session.merchant?.currency)}</td>
													<td class="px-table-cell-x py-table-cell-y"><Badge label={r.status} /></td>
													<td class="px-table-cell-x py-table-cell-y text-secondary" title={dateTimeFull(r.createdAt)}>{dateTime(r.createdAt)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</Card>
</div>