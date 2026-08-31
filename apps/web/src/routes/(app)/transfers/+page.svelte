<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { dateTime, number } from '$lib/format'
	import type { InventoryRow, StockTransfer, Warehouse } from '$lib/types'

	const canWrite = () => session.can('inventory:write')

	const STATUS_TONE: Record<string, string> = {
		pending: 'bg-warning/10 text-warning ring-warning',
		in_transit: 'bg-info/10 text-info ring-info',
		completed: 'bg-success/10 text-success ring-success',
		cancelled: 'bg-error/10 text-error ring-error'
	}
	const STATUS_ORDER = ['pending', 'in_transit', 'completed', 'cancelled']

	let items = $state<StockTransfer[]>([])
	let loading = $state(true)

	let statusFilter = $state('')

	let showCreate = $state(false)
	let warehouses = $state<Warehouse[]>([])
	let variants = $state<InventoryRow[]>([])
	let fFrom = $state('')
	let fTo = $state('')
	let fVariant = $state('')
	let fQty = $state('1')
	let saving = $state(false)

	let sourceText = $state('')
	let destText = $state('')

	const filtered = $derived(
		statusFilter ? items.filter((t) => (t.status ?? '').toLowerCase() === statusFilter) : items
	)
	const statusCount = (s: string) => items.filter((t) => (t.status ?? '').toLowerCase() === s).length

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: StockTransfer[] } }>('/api/transfers')
			items = res.data.items ?? []
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	async function openCreate() {
		showCreate = true
		fFrom = ''
		fTo = ''
		fVariant = ''
		fQty = '1'
		try {
			const [w, v] = await Promise.all([
				api.get<{ success: boolean; data: { items: Warehouse[] } }>('/api/warehouses'),
				api.get<{ success: boolean; data: { items: InventoryRow[] } }>('/api/inventory', { limit: '500', status: 'active' })
			])
			warehouses = w.data.items
			variants = v.data.items
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function create() {
		if (!fFrom || !fTo || !fVariant) return toast.error('Select source, destination and item')
		if (fFrom === fTo) return toast.error('Source and destination must differ')
		saving = true
		try {
			await api.post<{ success: boolean }>('/api/transfers', {
				fromWarehouseId: fFrom,
				toWarehouseId: fTo,
				variantId: fVariant,
				quantity: Number(fQty) || 1
			})
			toast.success('Transfer created')
			showCreate = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	const variantLabel = (v: InventoryRow) =>
		`${v.productName}${Object.keys(v.optionValues).length ? ` · ${Object.entries(v.optionValues).map(([k, x]) => `${k}: ${x}`).join(', ')}` : ''}${v.sku ? ` (${v.sku})` : ''}`

	const itemLabel = (t: StockTransfer) => {
		if (t.productName) {
			const options = Object.keys(t.optionValues).length
				? ` · ${Object.entries(t.optionValues).map(([k, v]) => `${k}: ${v}`).join(', ')}`
				: ''
			return `${t.productName}${options}`
		}
		return t.productSku ?? t.variantId
	}
</script>

<svelte:head>
	<title>Transfers — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Transfers</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage and track internal stock movements.</p>
		</div>
		{#if canWrite()}
			<Button onclick={openCreate}><Icon name="add" size="text-[18px]" /> Create transfer</Button>
		{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each STATUS_ORDER as s (s)}
			<Card>
				<div class="flex items-center justify-between">
					<p class="text-sm capitalize text-secondary">{s}</p>
					<span class="inline-flex h-2.5 w-2.5 rounded-full {STATUS_TONE[s].split(' ')[0]}"></span>
				</div>
				<p class="mt-1 font-display text-2xl text-on-surface">{loading ? '…' : number(statusCount(s))}</p>
			</Card>
		{/each}
	</div>

	<Card padded={false}>
		<div class="flex flex-wrap items-center gap-2 px-5 py-3">
			<div class="flex w-fit gap-1 rounded border border-outline-variant bg-surface-container-lowest p-1">
				<button
					class="rounded px-3 py-1.5 text-sm font-medium transition-colors {statusFilter === '' ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}"
					onclick={() => (statusFilter = '')}
				>
					All transfers
				</button>
				{#each STATUS_ORDER as s (s)}
					<button
						class="rounded px-3 py-1.5 text-sm capitalize transition-colors {statusFilter === s ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}"
						onclick={() => (statusFilter = s)}
					>
						{s.replace('_', ' ')}
					</button>
				{/each}
			</div>
		</div>

		{#if loading}
			<div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
				<Icon name="swap_horiz" size="text-[32px]" class="text-outline animate-pulse" />
				<p class="text-sm text-secondary">Loading transfers…</p>
			</div>
		{:else if filtered.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="swap_horiz" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No transfers {statusFilter ? `in “${statusFilter.replace('_', ' ')}”` : ''}.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
						<tr>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Transfer</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Source</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Destination</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Item</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Date</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Qty</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold"></th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as t (t.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<a href="/transfers/{t.id}" class="inline-block rounded py-1 font-mono-label text-mono-label font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">
										#{t.id.slice(0, 8).toUpperCase()}
									</a>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{t.sourceName ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{t.destinationName ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">
									<a href="/products/{t.productId}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">{itemLabel(t)}</a>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(t.createdAt)}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label font-medium text-on-surface">{number(t.quantity)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ring-inset {STATUS_TONE[(t.status ?? '').toLowerCase()] ?? 'bg-secondary/10 text-secondary ring-secondary'}">{(t.status ?? '').replace('_', ' ')}</span>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-right">
									<a href="/transfers/{t.id}" class="inline-flex rounded p-1.5 text-primary hover:bg-primary-fixed-dim/40" aria-label="View transfer"><Icon name="chevron_right" size="text-[18px]" /></a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
</div>

{#if showCreate && canWrite()}
	<Modal title="Create transfer" open={true} width="md" onClose={() => (showCreate = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); create() }}>
			<div>
				<label for="tr-from" class="field-label">Source warehouse</label>
				<select id="tr-from" class="field" bind:value={fFrom} onchange={() => (sourceText = warehouses.find((w) => w.id === fFrom)?.name ?? '')}>
					<option value="" disabled>Select source</option>
					{#each warehouses as w (w.id)}<option value={w.id}>{w.name} ({w.code})</option>{/each}
				</select>
			</div>
			<div>
				<label for="tr-to" class="field-label">Destination warehouse</label>
				<select id="tr-to" class="field" bind:value={fTo} onchange={() => (destText = warehouses.find((w) => w.id === fTo)?.name ?? '')}>
					<option value="" disabled>Select destination</option>
					{#each warehouses as w (w.id)}<option value={w.id} disabled={w.id === fFrom}>{w.name} ({w.code})</option>{/each}
				</select>
			</div>
			<div>
				<label for="tr-item" class="field-label">Item</label>
				<select id="tr-item" class="field" bind:value={fVariant}>
					<option value="" disabled>Select item</option>
					{#each variants as v (v.id)}
						<option value={v.id}>{variantLabel(v)} — {number(v.inventory)} in stock</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="tr-qty" class="field-label">Quantity</label>
				<input id="tr-qty" class="field" type="number" min="1" bind:value={fQty} required />
			</div>
			<p class="text-xs text-secondary">
				{sourceText && destText ? `Moving stock from ${sourceText} to ${destText}.` : 'A transfer moves stock between two of your warehouses.'}
			</p>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (showCreate = false)}>Cancel</Button>
				<Button type="submit" loading={saving}>Create transfer</Button>
			</div>
		</form>
	</Modal>
{/if}
