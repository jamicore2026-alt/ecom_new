<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { currency, number, pct } from '$lib/format'
	import type { ConversionAnalytics, CustomerAnalytics, ProductAnalytics, SalesAnalytics } from '$lib/types'

	type Tab = 'sales' | 'products' | 'customers' | 'conversion'
	let tab = $state<Tab>('sales')
	let days = $state('30')
	let loading = $state(true)

	let sales = $state<SalesAnalytics | null>(null)
	let products = $state<ProductAnalytics | null>(null)
	let customers = $state<CustomerAnalytics | null>(null)
	let conversion = $state<ConversionAnalytics | null>(null)

	const canRead = () => session.can('analytics:read')

	function range() {
		const from = new Date(Date.now() - (Number(days) - 1) * 86400000)
		return { from: from.toISOString().slice(0, 10) }
	}

	async function load() {
		loading = true
		try {
			if (tab === 'sales') {
				const res = await api.get<{ success: boolean; data: SalesAnalytics }>('/api/analytics/sales', { from: range().from })
				sales = res.data
			} else if (tab === 'products') {
				const res = await api.get<{ success: boolean; data: ProductAnalytics }>('/api/analytics/products', { from: range().from })
				products = res.data
			} else if (tab === 'customers') {
				const res = await api.get<{ success: boolean; data: CustomerAnalytics }>('/api/analytics/customers', { from: range().from })
				customers = res.data
			} else {
				const res = await api.get<{ success: boolean; data: ConversionAnalytics }>('/api/analytics/conversion', { from: range().from })
				conversion = res.data
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
		load()
	}

	function barWidth(v: number, max: number) {
		return max > 0 ? `${Math.max(3, (v / max) * 100)}%` : '3%'
	}
</script>

<svelte:head>
	<title>Analytics — Merchant OS</title>
</svelte:head>

{#if !canRead()}
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
		You need the <span class="font-semibold text-on-surface">analytics:read</span> permission to view analytics.
	</div>
{:else}
	<div class="space-y-6">
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div>
				<h1 class="font-display text-display text-on-surface">Analytics</h1>
			</div>
			<select class="field w-auto self-start md:self-auto" bind:value={days} onchange={load}>
				<option value="7">Last 7 days</option>
				<option value="30">Last 30 days</option>
				<option value="90">Last 90 days</option>
			</select>
		</div>

		<div class="flex w-fit max-w-full gap-1 overflow-x-auto rounded border border-outline-variant bg-surface-container-lowest p-1">
			{#each ['sales', 'products', 'customers', 'conversion'] as t (t)}
				<button
					class="rounded px-3 py-1.5 text-sm font-medium transition-colors {tab === t ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}"
					onclick={() => switchTab(t as Tab)}
				>
					{t[0].toUpperCase() + t.slice(1)}
				</button>
			{/each}
		</div>

		{#if loading}
			<div class="grid gap-4">
				{#each Array(3) as _}
					<div class="h-32 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if tab === 'sales' && sales}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Revenue</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{currency(sales.revenue)}</p>
					<p class="mt-0.5 text-xs text-success">{sales.comparison.revenueDeltaPct > 0 ? '+' : ''}{sales.comparison.revenueDeltaPct}% vs prev</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Orders</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(sales.orders)}</p>
					<p class="mt-0.5 text-xs text-success">{sales.comparison.ordersDeltaPct > 0 ? '+' : ''}{sales.comparison.ordersDeltaPct}% vs prev</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Avg order value</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{currency(sales.aov)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Net revenue</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{currency(sales.netRevenue)}</p>
					<p class="mt-0.5 text-xs text-error">{currency(-sales.refunds)} refunds</p>
				</div>
			</div>
			<Card title="Revenue over time" headingLevel="h2">
				{#if sales.series.length === 0}
					<p class="py-10 text-center text-sm text-secondary">No data yet.</p>
				{:else}
					<div class="flex h-56 items-end gap-1">
						{#each sales.series as s (s.date)}
							<div class="group flex-1">
								<div class="relative flex h-56 items-end">
									<div class="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style="height:{barWidth(s.revenue, Math.max(...sales.series.map((x) => x.revenue), 1))}" title={`${s.date}: ${currency(s.revenue)} · ${s.orders} orders`}></div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</Card>
		{:else if tab === 'products' && products}
			<div class="grid gap-6 lg:grid-cols-2">
				<Card title="Top products" headingLevel="h2">
					<ul class="space-y-3">
						{#each products.top as p (p.productId)}
							<li class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-on-surface">{p.name}</p>
									<p class="text-xs text-secondary">{number(p.quantity)} sold · {number(p.ordersCount)} orders</p>
								</div>
								<span class="font-mono-label text-mono-label text-on-surface">{currency(p.revenue)}</span>
							</li>
						{/each}
						{#if products.top.length === 0}
							<li class="py-8 text-center text-sm text-secondary">No sales in this period.</li>
						{/if}
					</ul>
				</Card>

				<Card title="By category" headingLevel="h2">
					<ul class="space-y-3">
						{#each products.categoryBreakdown as c (c.categoryId ?? 'none')}
							<li class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-on-surface">{c.categoryName ?? 'Uncategorized'}</p>
									<p class="text-xs text-secondary">{number(c.quantity)} units</p>
								</div>
								<span class="font-mono-label text-mono-label text-on-surface">{currency(c.revenue)}</span>
							</li>
						{/each}
						{#if products.categoryBreakdown.length === 0}
							<li class="py-8 text-center text-sm text-secondary">No data.</li>
						{/if}
					</ul>
				</Card>

				<div class="lg:col-span-2">
					<Card title="Low performers" headingLevel="h2" padded={false}>
						{#if products.lowPerformers.length === 0}
							<p class="py-8 text-center text-sm text-secondary">No data.</p>
						{:else}
							<div class="overflow-x-auto">
								<table class="w-full text-left text-sm">
									<thead>
										<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
											<th class="px-table-cell-x py-table-cell-y font-semibold">Product</th>
											<th class="px-table-cell-x py-table-cell-y font-semibold">SKU</th>
											<th class="px-table-cell-x py-table-cell-y font-semibold">Qty</th>
											<th class="px-table-cell-x py-table-cell-y font-semibold">Revenue</th>
										</tr>
									</thead>
									<tbody>
										{#each products.lowPerformers as p (p.productId)}
											<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
												<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{p.name}</td>
												<td class="px-table-cell-x py-table-cell-y text-secondary">{p.sku ?? '—'}</td>
												<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(p.quantity)}</td>
												<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(p.revenue)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</Card>
				</div>
			</div>
		{:else if tab === 'customers' && customers}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">New customers</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(customers.newCustomers)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Active customers</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(customers.activeCustomers)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Returning</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(customers.returningCustomers)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Repeat purchase rate</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{pct(customers.repeatPurchaseRate)}</p>
				</div>
			</div>

			<div class="grid gap-6 lg:grid-cols-2">
				<Card title="New customers per month" headingLevel="h2" padded={false}>
					{#if customers.monthlyNewCustomers.length === 0}
						<p class="py-10 text-center text-sm text-secondary">No data.</p>
					{:else}
						<div class="flex h-48 items-end gap-2 px-5 pt-5">
							{#each customers.monthlyNewCustomers as m (m.month)}
								<div class="flex h-full flex-1 flex-col items-center justify-end">
									<div class="w-full max-w-12 rounded-t bg-primary/80" style="height:{barWidth(m.count, Math.max(...customers.monthlyNewCustomers.map((x) => x.count), 1))}"></div>
									<span class="mt-1 text-[10px] text-secondary">{m.month.slice(5)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</Card>

				<Card title="Top spenders" headingLevel="h2" padded={false}>
					{#if customers.topSpenders.length === 0}
						<p class="py-10 text-center text-sm text-secondary">No customers.</p>
					{:else}
						<ul class="divide-y divide-outline-variant/60">
							{#each customers.topSpenders as c (c.id)}
								<li class="flex items-center justify-between gap-3 px-5 py-3">
									<div class="min-w-0">
										<a href="/customers/{c.id}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">{c.firstName ?? ''} {c.lastName ?? ''}</a>
										<p class="text-xs text-secondary">{c.ordersCount} orders</p>
									</div>
									<span class="font-mono-label text-mono-label text-on-surface">{currency(c.totalSpent)}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Card>
			</div>
		{:else if tab === 'conversion' && conversion}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Conversion rate</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{pct(conversion.conversionRate)}</p>
					<p class="mt-0.5 text-xs text-success">{conversion.comparison.conversionDeltaPct > 0 ? '+' : ''}{conversion.comparison.conversionDeltaPct}% vs prev</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Views</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(conversion.views)}</p>
					<p class="mt-0.5 text-xs text-success">{conversion.comparison.viewsDeltaPct > 0 ? '+' : ''}{conversion.comparison.viewsDeltaPct}% vs prev</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Cart adds</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(conversion.cartAdds)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Checkouts</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(conversion.checkouts)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Paid</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(conversion.paid)}</p>
				</div>
			</div>

			<div class="grid gap-6 lg:grid-cols-2">
				<Card title="Funnel" headingLevel="h2">
					<div class="space-y-3">
						{#each [
							{ label: 'View → Cart', value: conversion.funnel.viewToCart },
							{ label: 'Cart → Checkout', value: conversion.funnel.cartToCheckout },
							{ label: 'Checkout → Paid', value: conversion.funnel.checkoutToPaid }
						] as f (f.label)}
							<div>
								<div class="mb-1 flex justify-between text-sm">
									<span class="text-on-surface-variant">{f.label}</span>
									<span class="font-semibold text-on-surface">{pct(f.value)}</span>
								</div>
								<div class="h-2 rounded-full bg-surface-container">
									<div class="h-2 rounded-full bg-primary" style="width:{barWidth(f.value, 100)}"></div>
								</div>
							</div>
						{/each}
					</div>
				</Card>

				<Card title="By channel" headingLevel="h2" padded={false}>
					{#if conversion.byChannel.length === 0}
						<p class="py-10 text-center text-sm text-secondary">No data.</p>
					{:else}
						<div class="overflow-x-auto">
							<table class="w-full text-left text-sm">
								<thead>
									<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
										<th class="px-table-cell-x py-table-cell-y font-semibold">Channel</th>
										<th class="px-table-cell-x py-table-cell-y font-semibold">Views</th>
										<th class="px-table-cell-x py-table-cell-y font-semibold">Paid</th>
										<th class="px-table-cell-x py-table-cell-y font-semibold">Conversion</th>
									</tr>
								</thead>
								<tbody>
									{#each conversion.byChannel as c (c.channel)}
										<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
											<td class="px-table-cell-x py-table-cell-y font-medium text-on-surface">{c.channel}</td>
											<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(c.views)}</td>
											<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(c.paid)}</td>
											<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{pct(c.conversionRate)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</Card>
			</div>
		{:else}
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-8 text-center text-sm text-secondary">No data available.</div>
		{/if}
	</div>
{/if}