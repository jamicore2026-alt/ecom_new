<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Button from '$lib/components/Button.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { currency, dateTime, dateTimeFull, number } from '$lib/format'
	import type { CustomerDetail } from '$lib/types'

	interface CartItemLine {
		name: string
		price: number
		quantity: number
	}

	interface CartRow {
		id: string
		customerId: string | null
		itemCount: number
		quantity?: number
		subtotal?: number
		items?: CartItemLine[]
		status: string
		abandonedAt: string | null
		recoverySentAt?: string | null
		recoveredOrderId?: string | null
		lastActivityAt: string
		createdAt: string
	}

	interface RecoveryReport {
		recoveredOrders: number
		recoveredRevenue: number
		abandonedCarts: number
		emailedCarts: number
		conversionRate: number
	}

	const CART_LIMIT = 50

	let carts = $state<CartRow[]>([])
	let page = $state(1)
	let status = $state('abandoned')
	let loading = $state(true)
	let customerById = $state<Record<string, CustomerDetail | null>>({})
	let selected = $state<CartRow | null>(null)
	let report = $state<RecoveryReport | null>(null)
	let sweeping = $state(false)

	const hasNext = $derived(carts.length === CART_LIMIT)

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = { page: String(page), limit: String(CART_LIMIT) }
			if (status && status !== 'all') params.status = status
			const res = await api.get<{ success: boolean; data: { items: CartRow[]; page: number; limit: number } }>(
				'/api/carts',
				params
			)
			carts = res.data.items
			await enrich(res.data.items)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function enrich(items: CartRow[]) {
		const ids = new Set(items.map((c) => c.customerId).filter((id): id is string => !!id))
		for (const id of ids) {
			if (id in customerById) continue
			try {
				const r = await api.get<{ success: boolean; data: CustomerDetail }>(`/api/customers/${id}`)
				customerById[id] = r.data
			} catch (e) {
				if ((e as { status?: number }).status !== 404) toast.error((e as Error).message)
				customerById[id] = null
			}
		}
	}

	onMount(async () => {
		await load()
		try {
			const res = await api.get<{ success: boolean; data: RecoveryReport }>('/api/carts/recovery-report')
			report = res.data
		} catch {
			/* non-fatal */
		}
	})

	async function sweep() {
		sweeping = true
		try {
			const res = await api.post<{ success: boolean; data: { touched: number } }>('/api/carts/sweep', {})
			toast.success(`Sweep sent ${res.data.touched} recovery email(s)`)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			sweeping = false
		}
	}

	function applyFilters() {
		page = 1
		load()
	}

	function onPage(p: number) {
		if (p < 1) return
		page = p
		load()
	}

	function customerName(c: CartRow): string {
		const cust = c.customerId ? customerById[c.customerId] : undefined
		if (!cust) return '—'
		const name = [cust.firstName, cust.lastName].filter(Boolean).join(' ').trim()
		return name || '—'
	}

	function customerEmail(c: CartRow): string {
		const cust = c.customerId ? customerById[c.customerId] : undefined
		return cust?.email || '—'
	}

	function shortId(id: string): string {
		return id.length > 8 ? `${id.slice(0, 8)}…` : id
	}
</script>

<svelte:head>
	<title>Cart Recovery — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Cart Recovery</h1>
			<p class="mt-1 text-body-sm text-secondary">Two-touch recovery: reminder after 24h, 10% single-use incentive after 48h. Opted-out shoppers and recent buyers are suppressed.</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button variant="secondary" size="sm" loading={sweeping} onclick={sweep}><Icon name="send" size="text-[16px]" /> Run sweep now</Button>
		</div>
	</div>

	{#if report}
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Recovered orders</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(report.recoveredOrders)}</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Recovered revenue</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{currency(report.recoveredRevenue)}</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Abandoned carts</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(report.abandonedCarts)}</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Emailed</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(report.emailedCarts)}</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Recovery rate</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{report.conversionRate}%</p>
			</div>
		</div>
	{/if}

	<div class="space-y-3">
		<div class="flex flex-wrap items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest p-3">
			<Icon name="info" size="text-[18px]" class="text-secondary" />
			<p class="text-xs text-secondary">Guest carts link to a customer when the checkout email matches; pure-guest carts cannot be emailed. Converted carts are never re-touched.</p>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<select
				class="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary"
				bind:value={status}
				onchange={applyFilters}
				aria-label="Filter by cart status"
			>
				<option value="abandoned">Abandoned</option>
				<option value="active">Active</option>
				<option value="converted">Converted</option>
				<option value="all">All carts</option>
			</select>
		</div>
	</div>

	<Card padded={false} title={`Carts (${carts.length})`}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if carts.length === 0}
			<div class="flex flex-col items-center gap-3 py-16 text-center">
				<Icon name="shopping_cart_checkout" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No carts found.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Cart</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Customer</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Items</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Subtotal</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Reminder sent</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Abandoned</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Last activity</th>
						</tr>
					</thead>
					<tbody>
						{#each carts as c (c.id)}
							<tr class="cursor-pointer border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low" onclick={() => (selected = c)}>
								<td class="px-table-cell-x py-table-cell-y font-mono text-xs text-secondary">{shortId(c.id)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<p class="font-medium text-on-surface">{customerName(c)}</p>
									<p class="text-xs text-secondary">{customerEmail(c)}</p>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface">{c.itemCount}{c.quantity != null && c.quantity !== c.itemCount ? ` (${c.quantity} units)` : ''}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface">{c.subtotal != null ? currency(c.subtotal) : '—'}</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={c.status} /></td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{c.recoverySentAt ? dateTime(c.recoverySentAt) : '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(c.abandonedAt)}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(c.lastActivityAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<nav class="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant px-4 py-3">
				<p class="text-xs text-secondary">
					Page {page}
				</p>
				<div class="flex flex-wrap items-center gap-1">
					<button
						class="min-h-11 rounded px-3 text-sm text-secondary hover:bg-surface-container disabled:opacity-40"
						disabled={page <= 1}
						onclick={() => onPage(page - 1)}
					>
						‹ Prev
					</button>
					<button
						class="min-h-11 rounded px-3 text-sm text-secondary hover:bg-surface-container disabled:opacity-40"
						disabled={!hasNext}
						onclick={() => onPage(page + 1)}
					>
						Next ›
					</button>
				</div>
			</nav>
		{/if}
	</Card>
</div>

{#if selected}
	<Modal title="Cart details" open={true} onClose={() => (selected = null)}>
		<dl class="space-y-3 text-sm">
			<div class="flex justify-between gap-4">
				<dt class="text-secondary">Cart</dt>
				<dd class="break-all text-right font-mono text-xs text-on-surface">{selected.id}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-secondary">Customer</dt>
				<dd class="text-right text-on-surface">
					{#if selected.customerId && customerById[selected.customerId]}
						<span>{customerName(selected)}</span>
						<span class="block text-xs text-secondary">{customerEmail(selected)}</span>
					{:else}
						<span>—</span>
					{/if}
				</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-secondary">Items</dt>
				<dd class="text-on-surface">{selected.itemCount}{selected.subtotal != null ? ` · ${currency(selected.subtotal)}` : ''}</dd>
			</div>
			{#if selected.items?.length}
				<ul class="space-y-1 rounded border border-outline-variant bg-surface-container-low p-2.5">
					{#each selected.items as item (item.name)}
						<li class="flex justify-between gap-4 text-sm text-on-surface-variant">
							<span>{item.name} × {item.quantity}</span>
							<span>{currency(item.price * item.quantity)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="flex justify-between gap-4">
				<dt class="text-secondary">Status</dt>
				<dd><Badge label={selected.status} /></dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-secondary">Abandoned</dt>
				<dd class="text-on-surface-variant">{dateTimeFull(selected.abandonedAt)}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-secondary">Last activity</dt>
				<dd class="text-on-surface-variant">{dateTimeFull(selected.lastActivityAt)}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-secondary">Created</dt>
				<dd class="text-on-surface-variant">{dateTimeFull(selected.createdAt)}</dd>
			</div>
		</dl>
		<div class="mt-5 flex justify-end">
			<button class="rounded px-3 py-2 text-sm font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => (selected = null)}>Close</button>
		</div>
	</Modal>
{/if}