<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { currency, number, pct } from '$lib/format'
	import type { ProfitReport } from '$lib/types'

	let days = $state('30')
	let loading = $state(true)
	let report = $state<ProfitReport | null>(null)

	const canRead = () => session.can('reports.read')

	function range() {
		const from = new Date(Date.now() - (Number(days) - 1) * 86400000)
		return { from: from.toISOString().slice(0, 10) }
	}

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: ProfitReport }>('/api/profit', range())
			report = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	const bars = $derived.by(() => {
		if (!report) return []
		const m = report.metrics
		const net = m.revenue - m.cogs
		return [
			{ label: 'Revenue', value: m.revenue, format: 'revenue' },
			{ label: 'COGS', value: -m.cogs, format: 'negative' },
			{ label: 'Net profit', value: net, format: 'profit' }
		]
	})
</script>

<svelte:head>
	<title>Profit &amp; Loss — Merchant OS</title>
</svelte:head>

{#if !canRead()}
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
		You need the <span class="font-semibold text-on-surface">reports.read</span> permission to view profit &amp; loss.
	</div>
{:else}
	<div class="space-y-6">
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div>
				<h1 class="font-display text-display text-on-surface">Profit &amp; Loss</h1>
				<p class="mt-1 text-body-sm text-secondary">Financial performance report for the selected period.</p>
			</div>
			<div class="flex items-center gap-2">
				<select class="field w-auto self-start md:self-auto" bind:value={days} onchange={load}>
					<option value="7">Last 7 days</option>
					<option value="30">Last 30 days</option>
					<option value="90">Last 90 days</option>
					<option value="365">Last 12 months</option>
				</select>
				<Button size="sm" variant="secondary" onclick={() => window.print()}>Export PDF</Button>
			</div>
		</div>

		{#if loading || !report}
			<div class="grid gap-4">
				{#each Array(4) as _}
					<div class="h-32 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Gross revenue</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{currency(report.metrics.revenue)}</p>
					<p class="mt-0.5 text-xs text-secondary">{number(report.metrics.orderCount)} orders</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Cost of goods sold</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{currency(report.metrics.cogs)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Gross profit</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-primary">{currency(report.metrics.grossProfit)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="text-xs text-secondary">Gross margin</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{pct(report.metrics.margin)}</p>
				</div>
			</div>

			<Card title="Profit breakdown" headingLevel="h2" padded={false}>
				<div class="flex h-64 items-end gap-6 px-6 pt-6">
					{#each bars as b (b.label)}
						<div class="flex h-full flex-1 flex-col items-center justify-end gap-2">
							<span class="font-mono-label text-mono-label text-on-surface">
								{b.format === 'negative' ? `−${currency(Math.abs(b.value))}` : b.format === 'profit' && b.value >= 0 ? currency(b.value) : currency(b.value)}
							</span>
							<div class="w-full max-w-32 rounded-t bg-primary/80" style="height:{Math.max(3, (Math.abs(b.value) / Math.max(bars.reduce((m, x) => Math.max(m, Math.abs(x.value)), 0), 1)) * 100)}%"></div>
							<span class="text-xs text-secondary">{b.label}</span>
						</div>
					{/each}
				</div>
			</Card>

			<Card>
				<div class="flex flex-wrap gap-4 text-sm">
					<div class="min-w-[180px] flex-1">
						<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="calendar_today" size="text-[14px]" /> Reporting period</p>
						<p class="mt-1 text-on-surface-variant">
							{report.range.from ? new Date(report.range.from).toLocaleDateString() : 'All time'}{report.range.to ? ` – ${new Date(report.range.to).toLocaleDateString()}` : ''}
						</p>
					</div>
					<div class="min-w-[180px] flex-1">
						<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="receipt_long" size="text-[14px]" /> Accuracy</p>
						<p class="mt-1 text-on-surface-variant">Computed from paid orders in range</p>
					</div>
				</div>
			</Card>
		{/if}
	</div>
{/if}