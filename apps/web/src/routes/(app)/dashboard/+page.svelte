<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import { currency, dateTimeFull, timeAgo, number } from '$lib/format'
	import type { OverviewData } from '$lib/types'

	let data = $state<OverviewData | null>(null)
	let loading = $state(true)

	onMount(async () => {
		try {
			const res = await api.get<{ success: boolean; data: OverviewData }>('/api/overview')
			data = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	})

	let currencyCode = $derived(session.merchant?.currency ?? data?.currency ?? 'USD')

	let chart = $derived.by(() => {
		if (!data || data.salesChart.length === 0) return null
		const max = Math.max(...data.salesChart.map((p) => p.revenue), 1)
		const chartW = 600
		const chartH = 200
		const pad = 10
		const n = data.salesChart.length
		const stepX = (chartW - pad * 2) / Math.max(n - 1, 1)
		const pts = data.salesChart.map((p, i) => ({
			x: pad + i * stepX,
			y: chartH - pad - (p.revenue / max) * (chartH - pad * 2)
		}))
		return { max, pts, chartW, chartH, pad }
	})

	let chartTicks = $derived.by(() => {
		if (!chart || !data || data.salesChart.length === 0) return null
		const { max, pad, chartW, chartH } = chart

		const yTicks = Array.from({ length: 5 }, (_, i) => {
			const val = (max / 4) * i
			const y = chartH - pad - (val / max) * (chartH - pad * 2)
			return { label: currency(val, currencyCode), y }
		})

		const xTicks = data.salesChart.map((p, i) => {
			const d = new Date(p.date)
			return {
				label: `${d.getMonth() + 1}/${d.getDate()}`,
				x: chart.pts[i].x
			}
		})

		return { yTicks, xTicks }
	})

	function formatOrderNumber(num: string) {
		if (num.length <= 12) return num
		return num.slice(0, 6) + '\u2026' + num.slice(-4)
	}

	const stats = [
		{ label: 'Today\'s sales', key: 'todaySales' as const },
		{ label: 'Orders today', key: 'ordersToday' as const },
		{ label: 'Avg order value', key: 'avgOrderValue' as const },
		{ label: 'Pending orders', key: 'pendingOrders' as const },
		{ label: 'Low stock', key: 'lowStockCount' as const },
		{ label: 'Out of stock', key: 'outOfStockCount' as const }
	]
</script>

{#if loading}
	<div class="grid gap-4">
		<div class="h-40 animate-pulse rounded-xl bg-gray-200"></div>
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			{#each Array(4) as _}
				<div class="h-24 animate-pulse rounded-xl bg-gray-200"></div>
			{/each}
		</div>
	</div>
{:else if data}
	<div class="space-y-6">
		<h1 class="sr-only">Dashboard</h1>
		<!-- Stat cards -->
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-6">
			{#each stats as s}
				<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium text-gray-500">{s.label}</p>
					<p class="mt-1.5 text-xl font-bold text-gray-900">
						{s.key === 'todaySales' || s.key === 'avgOrderValue'
							? currency(data![s.key], currencyCode)
							: number(data![s.key])}
					</p>
				</div>
			{/each}
		</div>

		<!-- Sales chart + top products -->
		<div class="grid gap-6 lg:grid-cols-3">
			<div class="lg:col-span-2">
				<Card title="Revenue (last 14 days)" headingLevel="h2">
					<div class="h-64">
						{#if data.salesChart.length === 0}
							<div class="flex h-full items-center justify-center text-sm text-gray-400">
								No sales data yet
							</div>
						{:else}
							{@const pts = chart?.pts ?? []}
							{@const chartW = chart?.chartW ?? 600}
							{@const chartH = chart?.chartH ?? 200}
							{@const pad = chart?.pad ?? 10}
							<svg viewBox="0 0 680 280" class="h-full w-full" preserveAspectRatio="none">
								<defs>
									<linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="#6366f1" stop-opacity="0.25" />
										<stop offset="100%" stop-color="#6366f1" stop-opacity="0" />
									</linearGradient>
								</defs>
								{#if chartTicks}
									{#each chartTicks.yTicks as t}
										<text x="70" y={t.y + 4} text-anchor="end" class="fill-gray-400" font-size="10">{t.label}</text>
										<line x1="72" y1={t.y} x2={chartW + 60} y2={t.y} class="stroke-gray-100" />
									{/each}
								{/if}
								<g transform="translate(70,0)">
									<polygon
										points={`${pts[0].x},${chartH - pad} ${pts.map((p) => `${p.x},${p.y}`).join(' ')} ${pts[pts.length - 1].x},${chartH - pad}`}
										fill="url(#area)"
									/>
									<polyline
										points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
										fill="none"
										stroke="#6366f1"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
									{#each pts as p, i (i)}
										<circle cx={p.x} cy={p.y} r="3" fill="#6366f1">
											<title>{currency(data.salesChart[i].revenue, currencyCode)} — {data.salesChart[i].date}</title>
										</circle>
									{/each}
								</g>
								{#if chartTicks}
									{#each chartTicks.xTicks as t, i}
										{#if i % 3 === 0 || i === chartTicks.xTicks.length - 1}
											<text x={t.x + 70} y={chartH - pad + 18} text-anchor="middle" class="fill-gray-400" font-size="10">{t.label}</text>
										{/if}
									{/each}
								{/if}
							</svg>
						{/if}
					</div>
				</Card>
			</div>

			<Card title="Top products" headingLevel="h2">
				{#if data.topProducts.length === 0}
					<p class="py-8 text-center text-sm text-gray-400">No product sales yet</p>
				{:else}
					<ul class="space-y-3">
						{#each data.topProducts as p (p.productId)}
							<li class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<a href="/products/{p.productId}" class="group block truncate text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline">{p.name}</a>
									<p class="text-xs text-gray-500">{number(p.quantity)} sold</p>
								</div>
								<div class="flex items-center gap-2">
									<span class="text-sm font-semibold text-gray-900">{currency(p.revenue, currencyCode)}</span>
									<svg class="h-4 w-4 shrink-0 text-gray-300 group-hover:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card>
		</div>

		<!-- Recent orders -->
		<Card title="Recent orders" headingLevel="h2" padded={false}>
			{#if data.recentOrders.length === 0}
				<p class="py-10 text-center text-sm text-gray-400">No orders yet</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
								<th class="px-5 py-3">Order</th>
								<th class="px-5 py-3">Customer</th>
								<th class="px-5 py-3">Status</th>
								<th class="px-5 py-3">Payment</th>
								<th class="px-5 py-3">Total</th>
								<th class="px-5 py-3">Placed</th>
							</tr>
						</thead>
						<tbody>
							{#each data.recentOrders as o (o.id)}
								<tr class="border-b border-gray-50 hover:bg-gray-50/60">
								<td class="px-5 py-3 font-medium text-indigo-600">
									<a href="/orders/{o.id}" class="lowercase" title={o.orderNumber}>#{formatOrderNumber(o.orderNumber)}</a>
								</td>
									<td class="px-5 py-3 text-gray-700">{o.customerName}</td>
									<td class="px-5 py-3"><Badge label={o.status} /></td>
									<td class="px-5 py-3"><Badge label={o.paymentStatus} /></td>
									<td class="px-5 py-3 font-medium text-gray-900">{currency(o.total, o.currency)}</td>
									<td class="px-5 py-3 text-gray-500" title={dateTimeFull(o.createdAt)}>{timeAgo(o.createdAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	</div>
{:else}
	<p class="text-sm text-gray-500">Unable to load dashboard.</p>
{/if}
