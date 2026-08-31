<script lang="ts">
	import { page } from '$app/state'
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { dateTime, dateTimeFull, number } from '$lib/format'
	import type { StockTransfer } from '$lib/types'

	const STATUS_TONE: Record<string, string> = {
		pending: 'bg-warning/10 text-warning ring-warning',
		in_transit: 'bg-info/10 text-info ring-info',
		completed: 'bg-success/10 text-success ring-success',
		cancelled: 'bg-error/10 text-error ring-error'
	}

	let transfer = $state<StockTransfer | null>(null)
	let loading = $state(true)
	let missing = $state(false)

	const id = $derived(page.params.id as string)

	async function load() {
		loading = true
		missing = false
		try {
			const res = await api.get<{ success: boolean; data: StockTransfer }>(`/api/transfers/${id}`)
			transfer = res.data
		} catch (e) {
			const status = (e as { status?: number }).status
			if (status === 404) missing = true
			else toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	const optionText = (t: StockTransfer) => {
		if (!t || !Object.keys(t.optionValues).length) return 'Default'
		return Object.entries(t.optionValues).map(([k, v]) => `${k}: ${v}`).join(', ')
	}
</script>

<svelte:head>
	<title>Transfer — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
			<Icon name="swap_horiz" size="text-[32px]" class="text-outline animate-pulse" />
			<p class="text-sm text-secondary">Loading transfer…</p>
		</div>
	{:else if missing || !transfer}
		<Card>
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="search_off" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">This transfer could not be found.</p>
				<a href="/transfers" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">Back to transfers</a>
			</div>
		</Card>
	{:else}
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div class="flex items-center gap-3">
				<a href="/transfers" class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" aria-label="Back to transfers">
					<Icon name="chevron_left" size="text-[20px]" />
				</a>
				<div>
					<h1 class="font-display text-display text-on-surface">#{transfer.id.slice(0, 8).toUpperCase()}</h1>
					<p class="mt-1 text-body-sm text-secondary">Stock transfer · {dateTime(transfer.createdAt)}</p>
				</div>
			</div>
			<span class="inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset {STATUS_TONE[(transfer.status ?? '').toLowerCase()] ?? 'bg-secondary/10 text-secondary ring-secondary'}">
				{(transfer.status ?? '').replace('_', ' ')}
			</span>
		</div>

		<div class="grid gap-4 lg:grid-cols-3">
			<Card>
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-semibold text-on-surface">Source</h2>
					<Icon name="route" size="text-[18px]" class="text-primary" />
				</div>
				<p class="font-medium text-on-surface">{transfer.sourceName ?? '—'}</p>
				<p class="text-xs text-secondary">{transfer.sourceCode ? `Code ${transfer.sourceCode}` : 'No code'}</p>
			</Card>

			<Card>
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-semibold text-on-surface">Destination</h2>
					<Icon name="location_on" size="text-[18px]" class="text-primary" />
				</div>
				<p class="font-medium text-on-surface">{transfer.destinationName ?? '—'}</p>
				<p class="text-xs text-secondary">{transfer.destinationCode ? `Code ${transfer.destinationCode}` : 'No code'}</p>
			</Card>

			<Card>
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-semibold text-on-surface">Item</h2>
					<Icon name="inventory_2" size="text-[18px]" class="text-primary" />
				</div>
				{#if transfer.productId}
					<a href="/products/{transfer.productId}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">{transfer.productName}</a>
				{:else}
					<p class="font-medium text-on-surface">{transfer.productName ?? '—'}</p>
				{/if}
				<p class="text-xs text-secondary">{optionText(transfer)}</p>
				<p class="mt-1 font-mono-label text-mono-label text-on-surface-variant">{transfer.variantSku ?? transfer.productSku ?? 'No SKU'}</p>
			</Card>
		</div>

		<div class="grid gap-4 lg:grid-cols-3">
			<Card>
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-semibold text-on-surface">Quantity</h2>
					<Icon name="swap_horiz" size="text-[18px]" class="text-primary" />
				</div>
				<p class="font-display text-3xl text-on-surface">{number(transfer.quantity)}</p>
				<p class="mt-1 text-xs text-secondary">units moved</p>
			</Card>

			<Card>
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-semibold text-on-surface">Created</h2>
					<Icon name="calendar_today" size="text-[18px]" class="text-primary" />
				</div>
				<p class="font-medium text-on-surface">{dateTime(transfer.createdAt)}</p>
				<p class="text-xs text-secondary" title={dateTimeFull(transfer.createdAt)}>{dateTimeFull(transfer.createdAt)}</p>
			</Card>

			<Card>
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-semibold text-on-surface">Completed</h2>
					<Icon name="event_available" size="text-[18px]" class="text-success" />
				</div>
				<p class="font-medium text-on-surface">{transfer.completedAt ? dateTime(transfer.completedAt) : '—'}</p>
				<p class="text-xs text-secondary">{transfer.completedAt ? dateTimeFull(transfer.completedAt) : 'Not yet completed'}</p>
			</Card>
		</div>

		<Card>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-sm font-semibold text-on-surface">Timeline</h2>
				<Button size="sm" variant="secondary" onclick={() => window.print()}>Print manifest</Button>
			</div>
			<ol class="space-y-4">
				<li class="flex gap-3">
					<span class="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon name="check" size="text-[14px]" /></span>
					<div>
						<p class="text-sm font-medium text-on-surface">Initiated</p>
						<p class="text-xs text-secondary">{dateTimeFull(transfer.createdAt)}</p>
					</div>
				</li>
				<li class="flex gap-3">
					<span class="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-success/10 text-success"><Icon name="check_circle" size="text-[14px]" /></span>
					<div>
						<p class="text-sm font-medium text-on-surface">Completed</p>
						<p class="text-xs text-secondary">
							{transfer.completedAt ? `${dateTimeFull(transfer.completedAt)} · stock moved from ${transfer.sourceName ?? 'source'} to ${transfer.destinationName ?? 'destination'}` : 'Awaiting completion'}
						</p>
					</div>
				</li>
			</ol>
		</Card>
	{/if}
</div>