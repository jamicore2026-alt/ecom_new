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

	/** Routes the current user may see (module + permission gated, same as sidebar). */
	let allowedRoutes = $derived(
		new Set(Object.values(session.visibleNav ?? {}).flat().map((i) => i.route))
	)

	const quickActions = [
		{ label: 'dash.qaOrders', route: '/orders', icon: 'receipt_long' },
		{ label: 'dash.qaProducts', route: '/products', icon: 'inventory_2' },
		{ label: 'dash.qaInventory', route: '/inventory', icon: 'warehouse' },
		{ label: 'dash.qaPos', route: '/pos', icon: 'point_of_sale' },
		{ label: 'dash.qaAnalytics', route: '/analytics', icon: 'insights' }
	]

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
		const avg = data.salesChart.reduce((s, p) => s + p.revenue, 0) / n
		const avgY = chartH - pad - (avg / max) * (chartH - pad * 2)
		return { max, pts, chartW, chartH, pad, avg, avgY }
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
		{ label: t('dash.todaySales'), key: 'todaySales' as const, route: '/orders', icon: 'payments' },
		{ label: t('dash.ordersToday'), key: 'ordersToday' as const, route: '/orders', icon: 'receipt_long' },
		{ label: t('dash.avgOrderValue'), key: 'avgOrderValue' as const, route: '/analytics', icon: 'insights' },
		{ label: t('dash.pendingOrders'), key: 'pendingOrders' as const, route: '/orders', icon: 'schedule' },
		{ label: t('dash.lowStock'), key: 'lowStockCount' as const, route: '/inventory', icon: 'warning' },
		{ label: t('dash.outOfStock'), key: 'outOfStockCount' as const, route: '/inventory', icon: 'error' }
	]
</script>

<svelte:head>
	<title>{t('dash.overview')} — JamiCore</title>
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
	<div class="dash-enter space-y-6">
		<!-- Page header -->
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div>
				<h1 class="font-display text-display text-on-surface">{t('dash.overview')}</h1>
				<p class="mt-1 text-body-sm text-secondary">{t('dash.execSummary', { store: session.merchant?.name ?? t('common.yourStore') })}</p>
			</div>
			<a
				href="/orders"
				class="inline-flex min-h-11 items-center gap-2 self-start rounded bg-primary px-4 text-sm font-medium text-on-primary transition-colors hover:bg-on-primary-fixed-variant"
			>
				<Icon name="receipt_long" size="text-[18px]" />
				{t('dash.viewOrders')}
			</a>
		</div>

		<!-- Quick actions (only routes this user may access) -->
		<div class="flex flex-wrap gap-2" role="navigation" aria-label={t('dash.quickActions')}>
			{#each quickActions.filter((a) => allowedRoutes.has(a.route)) as a, i (a.route)}
				<a
					href={a.route}
					class="dash-item inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-sm font-medium text-on-surface-variant shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary hover:shadow-md"
					style="animation-delay: {i * 60}ms"
				>
					<Icon name={a.icon} size="text-[18px]" />
					{t(a.label)}
				</a>
			{/each}
		</div>

		<!-- Stat cards -->
		<div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
			{#each stats as s, i (s.key)}
				{@const Wrapper = allowedRoutes.has(s.route) ? 'a' : 'div'}
				<svelte:element
					this={Wrapper}
					{...(allowedRoutes.has(s.route) ? { href: s.route } : {})}
					class="dash-item group relative flex flex-col overflow-hidden rounded border border-outline-variant bg-surface-container-lowest/80 p-4 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
					style="animation-delay: {(i + 2) * 60}ms"
					aria-label={allowedRoutes.has(s.route) ? `${s.label} — ${t('dash.viewAll')}` : s.label}
				>
					<span class="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary to-success opacity-0 transition-opacity group-hover:opacity-100"></span>
					<span class="flex items-center gap-1.5 font-mono-label text-mono-label uppercase tracking-wider text-secondary">
						<Icon name={s.icon} size="text-[16px]" />
						{s.label}
					</span>
					<span class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">
						{s.key === 'todaySales' || s.key === 'avgOrderValue'
							? currency(data![s.key], currencyCode)
							: number(data![s.key])}
					</span>
				</svelte:element>
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
							<svg viewBox="0 0 680 280" class="h-full w-full" preserveAspectRatio="none" role="img" aria-label={t('dash.revenue14')}>
								<defs>
									<linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="#22C55E" stop-opacity="0.25" />
										<stop offset="100%" stop-color="#22C55E" stop-opacity="0" />
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
										stroke="#22C55E"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
									<!-- 14-day average (dashed: series distinguished by style, not hue alone) -->
									<line
										x1={pad}
										y1={chart?.avgY}
										x2={chartW - pad}
										y2={chart?.avgY}
										stroke="#94A3B8"
										stroke-width="1.5"
										stroke-dasharray="6 4"
									>
										<title>{t('dash.avgLine')}: {currency(chart?.avg ?? 0, currencyCode)}</title>
									</line>
									{#each pts as p, i (i)}
										<circle cx={p.x} cy={p.y} r="3" fill="#22C55E">
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
							<!-- Screen-reader data table fallback -->
							<details class="mt-2 text-xs text-secondary">
								<summary class="cursor-pointer hover:text-primary">{t('dash.salesTable')}</summary>
								<table class="mt-2 w-full text-left">
									<thead>
										<tr>
											<th class="py-1 pe-4">{t('dash.tableDate')}</th>
											<th class="py-1 pe-4">{t('dash.tableRevenue')}</th>
											<th class="py-1">{t('dash.tableOrders')}</th>
										</tr>
									</thead>
									<tbody>
										{#each data.salesChart as p (p.date)}
											<tr class="border-t border-outline-variant/60">
												<td class="py-1 pe-4">{p.date}</td>
												<td class="py-1 pe-4">{currency(p.revenue, currencyCode)}</td>
												<td class="py-1">{number(p.orders)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</details>
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
									<a href="/products/{p.productId}" class="inline-flex min-h-11 items-center truncate text-sm font-medium text-primary hover:text-on-primary-fixed-variant hover:underline">{p.name}</a>
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
										<a href="/orders/{o.id}" class="lowercase inline-flex min-h-11 items-center" title={o.orderNumber}>#{formatOrderNumber(o.orderNumber)}</a>
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
				<div class="flex justify-end p-4">
					<a href="/orders" class="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">
						{t('dash.viewAll')}
						<Icon name="chevron_right" size="text-[18px]" />
					</a>
				</div>
			{/if}
		</Card>
	</div>
{:else}
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-8 text-center text-sm text-secondary">
		{t('common.loadFailed')}
	</div>
{/if}

<style>
	/* Stagger-in (Standard tier); static snapshot under reduced motion. */
	.dash-enter .dash-item {
		animation: dash-in 0.4s cubic-bezier(0.34, 1.4, 0.64, 1) both;
	}
	@keyframes dash-in {
		from {
			opacity: 0;
			transform: translateY(16px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dash-enter .dash-item {
			animation: none;
		}
		.dash-enter a {
			transition: none;
		}
	}
</style>
