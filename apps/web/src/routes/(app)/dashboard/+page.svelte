<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { currency, dateTimeFull, timeAgo, number } from '$lib/format'
	import { t } from '$lib/i18n'
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
		{ label: t('dash.todaySales'), key: 'todaySales' as const },
		{ label: t('dash.ordersToday'), key: 'ordersToday' as const },
		{ label: t('dash.avgOrderValue'), key: 'avgOrderValue' as const },
		{ label: t('dash.pendingOrders'), key: 'pendingOrders' as const },
		{ label: t('dash.lowStock'), key: 'lowStockCount' as const },
		{ label: t('dash.outOfStock'), key: 'outOfStockCount' as const }
	]
</script>

<svelte:head>
	<title>{t('dash.overview')} — Merchant OS</title>
</svelte:head>

{#if loading}
	<div class="grid gap-4">
		<div class="h-40 animate-pulse rounded bg-surface-container"></div>
		<div class="grid grid-cols-2 gap-4 lg:grid-cols-6">
			{#each Array(6) as _}
				<div class="h-24 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	</div>
{:else if data}
	<div class="space-y-6">
		<!-- Page header -->
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div>
				<h1 class="font-display text-display text-on-surface">{t('dash.overview')}</h1>
				<p class="mt-1 text-body-sm text-secondary">{t('dash.execSummary', { store: session.merchant?.name ?? t('common.yourStore') })}</p>
			</div>
			<a
				href="/orders"
				class="inline-flex items-center gap-2 self-start rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-on-primary-fixed-variant"
			>
				<Icon name="receipt_long" size="text-[18px]" />
				{t('dash.viewOrders')}
			</a>
		</div>

		<!-- Stat cards -->
		<div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
			{#each stats as s}
				<div class="relative flex flex-col rounded border border-outline-variant bg-surface-container-lowest p-4 transition-colors hover:border-primary">
					<span class="font-mono-label text-mono-label uppercase tracking-wider text-secondary">{s.label}</span>
					<span class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">
						{s.key === 'todaySales' || s.key === 'avgOrderValue'
							? currency(data![s.key], currencyCode)
							: number(data![s.key])}
					</span>
				</div>
			{/each}
		</div>

		<!-- Sales chart + top products -->
		<div class="grid gap-6 lg:grid-cols-3">
			<div class="lg:col-span-2">
				<Card title={t('dash.revenue14')} headingLevel="h2">
					<div class="h-64">
						{#if data.salesChart.length === 0}
							<div class="flex h-full items-center justify-center text-sm text-secondary">{t('common.noDataYet')}</div>
						{:else}
							{@const pts = chart?.pts ?? []}
							{@const chartW = chart?.chartW ?? 600}
							{@const chartH = chart?.chartH ?? 200}
							{@const pad = chart?.pad ?? 10}
							<svg viewBox="0 0 680 280" class="h-full w-full" preserveAspectRatio="none">
								<defs>
									<linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="#004ac6" stop-opacity="0.2" />
										<stop offset="100%" stop-color="#004ac6" stop-opacity="0" />
									</linearGradient>
								</defs>
								{#if chartTicks}
									{#each chartTicks.yTicks as t}
										<text x="70" y={t.y + 4} text-anchor="end" class="fill-on-surface-variant" font-size="10">{t.label}</text>
										<line x1="72" y1={t.y} x2={chartW + 60} y2={t.y} class="stroke-outline-variant" stroke-width="1" />
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
										stroke="#004ac6"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
									{#each pts as p, i (i)}
										<circle cx={p.x} cy={p.y} r="3" fill="#004ac6">
											<title>{currency(data.salesChart[i].revenue, currencyCode)} — {data.salesChart[i].date}</title>
										</circle>
									{/each}
								</g>
								{#if chartTicks}
									{#each chartTicks.xTicks as t, i}
										{#if i % 3 === 0 || i === chartTicks.xTicks.length - 1}
											<text x={t.x + 70} y={chartH - pad + 18} text-anchor="middle" class="fill-on-surface-variant" font-size="10">{t.label}</text>
										{/if}
									{/each}
								{/if}
							</svg>
						{/if}
					</div>
				</Card>
			</div>

			<Card title={t('dash.topProducts')} headingLevel="h2">
				{#if data.topProducts.length === 0}
					<p class="py-8 text-center text-sm text-secondary">{t('dash.noProductSales')}</p>
				{:else}
					<ul class="space-y-3">
						{#each data.topProducts as p (p.productId)}
							<li class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<a href="/products/{p.productId}" class="inline-block truncate py-1 text-sm font-medium text-primary hover:text-on-primary-fixed-variant hover:underline">{p.name}</a>
									<p class="text-xs text-secondary">{number(p.quantity)} {t('dash.sold')}</p>
								</div>
								<div class="flex items-center gap-2">
									<span class="font-mono-label text-mono-label text-on-surface">{currency(p.revenue, currencyCode)}</span>
									<Icon name="chevron_right" size="text-[18px]" class="text-outline" />
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card>
		</div>

		<!-- Recent orders -->
		<Card title={t('dash.recentOrders')} headingLevel="h2" padded={false}>
			{#if data.recentOrders.length === 0}
				<p class="py-10 text-center text-sm text-secondary">{t('common.noOrdersYet')}</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
								<th class="px-table-cell-x py-table-cell-y font-semibold">{t('orders.orderNumber')}</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">{t('orders.customer')}</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">{t('common.status')}</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">{t('orders.payment')}</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">{t('common.total')}</th>
								<th class="px-table-cell-x py-table-cell-y font-semibold">{t('dash.placed')}</th>
							</tr>
						</thead>
						<tbody>
							{#each data.recentOrders as o (o.id)}
								<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
									<td class="px-table-cell-x py-table-cell-y font-medium text-primary">
										<a href="/orders/{o.id}" class="lowercase" title={o.orderNumber}>#{formatOrderNumber(o.orderNumber)}</a>
									</td>
									<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{o.customerName}</td>
									<td class="px-table-cell-x py-table-cell-y"><Badge label={o.status} /></td>
									<td class="px-table-cell-x py-table-cell-y"><Badge label={o.paymentStatus} /></td>
									<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(o.total, o.currency)}</td>
									<td class="px-table-cell-x py-table-cell-y text-secondary" title={dateTimeFull(o.createdAt)}>{timeAgo(o.createdAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	</div>
{:else}
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-8 text-center text-sm text-secondary">
		{t('common.loadFailed')}
	</div>
{/if}