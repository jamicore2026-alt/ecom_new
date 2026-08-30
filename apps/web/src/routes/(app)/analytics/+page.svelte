<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
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

{#if !canRead()}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
		You need the <span class="font-semibold">analytics:read</span> permission to view analytics.
	</div>
{:else}
	<div class="space-y-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-xl font-bold text-gray-900">Analytics</h1>
			</div>
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={days} onchange={load}>
				<option value="7">Last 7 days</option>
				<option value="30">Last 30 days</option>
				<option value="90">Last 90 days</option>
			</select>
		</div>

		<div class="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 w-fit">
			{#each ['sales', 'products', 'customers', 'conversion'] as t (t)}
				<button class="rounded-md px-3 py-1.5 text-sm font-medium" class:bg-indigo-600={tab === t} class:text-white={tab === t} class:text-gray-600={tab !== t} onclick={() => switchTab(t as Tab)}>
					{t[0].toUpperCase() + t.slice(1)}
				</button>
			{/each}
		</div>

		{#if loading}
			<div class="grid gap-4">
				{#each Array(3) as _}
					<div class="h-32 animate-pulse rounded-xl bg-gray-200"></div>
				{/each}
			</div>
		{:else if tab === 'sales' && sales}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Revenue</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{currency(sales.revenue)}</p>
					<p class="mt-0.5 text-xs text-emerald-600">{sales.comparison.revenueDeltaPct > 0 ? '+' : ''}{sales.comparison.revenueDeltaPct}% vs prev</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Orders</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{number(sales.orders)}</p>
					<p class="mt-0.5 text-xs text-emerald-600">{sales.comparison.ordersDeltaPct > 0 ? '+' : ''}{sales.comparison.ordersDeltaPct}% vs prev</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Avg order value</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{currency(sales.aov)}</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Net revenue</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{currency(sales.netRevenue)}</p>
					<p class="mt-0.5 text-xs text-red-500">{currency(-sales.refunds)} refunds</p>
				</div>
			</div>
			<Card title="Revenue over time" headingLevel="h2">
				{#if sales.series.length === 0}
					<p class="py-10 text-center text-sm text-gray-400">No data.</p>
				{:else}
					<div class="flex h-56 items-end gap-1">
						{#each sales.series as s (s.date)}
							<div class="group flex-1">
								<div class="relative flex h-56 items-end">
									<div class="w-full rounded-t bg-indigo-500/90 transition-colors group-hover:bg-indigo-600" style="height:{barWidth(s.revenue, Math.max(...sales.series.map((x) => x.revenue), 1))}" title={`${s.date}: ${currency(s.revenue)} · ${s.orders} orders`}></div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</Card>
		{:else if tab === 'products' && products}
			<div class="grid gap-5 lg:grid-cols-2">
				<Card title="Top products" headingLevel="h2">
					<ul class="space-y-3">
						{#each products.top as p (p.productId)}
							<li class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-gray-900">{p.name}</p>
									<p class="text-xs text-gray-500">{number(p.quantity)} sold · {number(p.ordersCount)} orders</p>
								</div>
								<span class="text-sm font-semibold">{currency(p.revenue)}</span>
							</li>
						{/each}
						{#if products.top.length === 0}
							<li class="py-8 text-center text-sm text-gray-400">No sales in this period.</li>
						{/if}
					</ul>
				</Card>

				<Card title="By category" headingLevel="h2">
					<ul class="space-y-3">
						{#each products.categoryBreakdown as c (c.categoryId ?? 'none')}
							<li class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-gray-900">{c.categoryName ?? 'Uncategorized'}</p>
									<p class="text-xs text-gray-500">{number(c.quantity)} units</p>
								</div>
								<span class="text-sm font-semibold">{currency(c.revenue)}</span>
							</li>
						{/each}
						{#if products.categoryBreakdown.length === 0}
							<li class="py-8 text-center text-sm text-gray-400">No data.</li>
						{/if}
					</ul>
				</Card>

				<div class="lg:col-span-2">
					<Card title="Low performers" headingLevel="h2">
						{#if products.lowPerformers.length === 0}
							<p class="py-8 text-center text-sm text-gray-400">No data.</p>
						{:else}
							<div class="overflow-x-auto">
								<table class="w-full text-sm">
									<thead>
										<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
											<th class="py-2 pr-3">Product</th>
											<th class="py-2 pr-3">SKU</th>
											<th class="py-2 pr-3">Qty</th>
											<th class="py-2">Revenue</th>
										</tr>
									</thead>
									<tbody>
										{#each products.lowPerformers as p (p.productId)}
											<tr class="border-b border-gray-50">
												<td class="py-2 pr-3 text-gray-800">{p.name}</td>
												<td class="py-2 pr-3 text-gray-500">{p.sku ?? '—'}</td>
												<td class="py-2 pr-3">{number(p.quantity)}</td>
												<td class="py-2 font-medium">{currency(p.revenue)}</td>
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
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">New customers</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{number(customers.newCustomers)}</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Active customers</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{number(customers.activeCustomers)}</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Returning</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{number(customers.returningCustomers)}</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Repeat purchase rate</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{pct(customers.repeatPurchaseRate)}</p>
				</div>
			</div>

			<div class="grid gap-5 lg:grid-cols-2">
				<Card title="New customers per month" headingLevel="h2" padded={false}>
					{#if customers.monthlyNewCustomers.length === 0}
						<p class="py-10 text-center text-sm text-gray-400">No data.</p>
					{:else}
						<div class="flex h-48 items-end gap-2 px-5 pt-5">
							{#each customers.monthlyNewCustomers as m (m.month)}
								<div class="flex-1 flex flex-col items-center justify-end h-full">
									<div class="w-full max-w-12 rounded-t bg-indigo-500/90" style="height:{barWidth(m.count, Math.max(...customers.monthlyNewCustomers.map((x) => x.count), 1))}"></div>
									<span class="mt-1 text-[10px] text-gray-400">{m.month.slice(5)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</Card>

				<Card title="Top spenders" headingLevel="h2" padded={false}>
					{#if customers.topSpenders.length === 0}
						<p class="py-10 text-center text-sm text-gray-400">No customers.</p>
					{:else}
						<ul class="divide-y divide-gray-50">
							{#each customers.topSpenders as c (c.id)}
								<li class="flex items-center justify-between gap-3 px-5 py-3">
									<div class="min-w-0">
										<a href="/customers/{c.id}" class="truncate text-sm font-medium text-indigo-600 hover:text-indigo-800">{c.firstName ?? ''} {c.lastName ?? ''}</a>
										<p class="text-xs text-gray-500">{c.ordersCount} orders</p>
									</div>
									<span class="text-sm font-semibold">{currency(c.totalSpent)}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Card>
			</div>
		{:else if tab === 'conversion' && conversion}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Conversion rate</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{pct(conversion.conversionRate)}</p>
					<p class="mt-0.5 text-xs text-emerald-600">{conversion.comparison.conversionDeltaPct > 0 ? '+' : ''}{conversion.comparison.conversionDeltaPct}% vs prev</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Views</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{number(conversion.views)}</p>
					<p class="mt-0.5 text-xs text-emerald-600">{conversion.comparison.viewsDeltaPct > 0 ? '+' : ''}{conversion.comparison.viewsDeltaPct}% vs prev</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Cart adds</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{number(conversion.cartAdds)}</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Checkouts</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{number(conversion.checkouts)}</p>
				</div>
				<div class="rounded-xl border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Paid</p>
					<p class="mt-1 text-xl font-bold text-gray-900">{number(conversion.paid)}</p>
				</div>
			</div>

			<div class="grid gap-5 lg:grid-cols-2">
				<Card title="Funnel" headingLevel="h2">
					<div class="space-y-3">
						{#each [
							{ label: 'View → Cart', value: conversion.funnel.viewToCart },
							{ label: 'Cart → Checkout', value: conversion.funnel.cartToCheckout },
							{ label: 'Checkout → Paid', value: conversion.funnel.checkoutToPaid }
						] as f (f.label)}
							<div>
								<div class="mb-1 flex justify-between text-sm">
									<span class="text-gray-600">{f.label}</span>
									<span class="font-semibold">{pct(f.value)}</span>
								</div>
								<div class="h-2 rounded-full bg-gray-100">
									<div class="h-2 rounded-full bg-indigo-500" style="width:{barWidth(f.value, 100)}"></div>
								</div>
							</div>
						{/each}
					</div>
				</Card>

				<Card title="By channel" headingLevel="h2" padded={false}>
					{#if conversion.byChannel.length === 0}
						<p class="py-10 text-center text-sm text-gray-400">No data.</p>
					{:else}
						<div class="overflow-x-auto">
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
										<th class="px-5 py-3">Channel</th>
										<th class="px-3 py-3">Views</th>
										<th class="px-3 py-3">Paid</th>
										<th class="px-5 py-3">Conversion</th>
									</tr>
								</thead>
								<tbody>
									{#each conversion.byChannel as c (c.channel)}
										<tr class="border-b border-gray-50">
											<td class="px-5 py-3 font-medium text-gray-900">{c.channel}</td>
											<td class="px-3 py-3 text-gray-600">{number(c.views)}</td>
											<td class="px-3 py-3 text-gray-600">{number(c.paid)}</td>
											<td class="px-5 py-3 font-semibold text-gray-900">{pct(c.conversionRate)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</Card>
			</div>
		{:else}
			<p class="text-sm text-gray-500">No data available.</p>
		{/if}
	</div>
{/if}