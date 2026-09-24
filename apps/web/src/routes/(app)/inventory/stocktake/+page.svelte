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
	import type { InventoryRow, Warehouse } from '$lib/types'

	interface StocktakeSession {
		id: string
		warehouseId: string | null
		status: string
		notes: string | null
		createdAt: string
		approvedAt: string | null
		warehouseName: string | null
		itemCount: number
	}

	interface StocktakeItem {
		id: string
		variantId: string
		systemQuantity: number
		countedQuantity: number | null
		variance: number | null
		sku: string | null
		optionValues: Record<string, string>
		productId: string
		productName: string
	}

	interface SessionDetail extends StocktakeSession {
		items: StocktakeItem[]
	}

	const canWrite = () => session.can('inventory:write')

	let sessions = $state<StocktakeSession[]>([])
	let loading = $state(true)

	let showNew = $state(false)
	let warehouses = $state<Warehouse[]>([])
	let fWarehouse = $state('')
	let fNotes = $state('')
	let creating = $state(false)

	let detail = $state<SessionDetail | null>(null)
	let detailLoading = $state(false)

	let variants = $state<InventoryRow[]>([])
	let addVariantId = $state('')
	let addCount = $state('0')
	let adding = $state(false)
	let savingCount = $state<Record<string, boolean>>({})
	let busy = $state('')

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: StocktakeSession[] } }>('/api/stocktake/sessions')
			sessions = res.data.items ?? []
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	async function openNew() {
		showNew = true
		fWarehouse = ''
		fNotes = ''
		try {
			const res = await api.get<{ success: boolean; data: { items: Warehouse[] } }>('/api/warehouses')
			warehouses = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function createSession() {
		creating = true
		try {
			const res = await api.post<{ success: boolean; data: SessionDetail }>('/api/stocktake/sessions', {
				...(fWarehouse ? { warehouseId: fWarehouse } : {}),
				...(fNotes.trim() ? { notes: fNotes.trim() } : {})
			})
			toast.success('Stocktake session created')
			showNew = false
			await load()
			await openDetail(res.data.id)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			creating = false
		}
	}

	async function openDetail(id: string) {
		detail = null
		detailLoading = true
		addVariantId = ''
		try {
			const [d, v] = await Promise.all([
				api.get<{ success: boolean; data: SessionDetail }>(`/api/stocktake/sessions/${id}`),
				variants.length
					? Promise.resolve(null)
					: api.get<{ success: boolean; data: { items: InventoryRow[] } }>('/api/inventory', { limit: '500', status: 'active' })
			])
			detail = d.data
			if (v) variants = v.data.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			detailLoading = false
		}
	}

	async function addItem() {
		if (!detail || !addVariantId) return toast.error('Select an item')
		adding = true
		try {
			await api.post(`/api/stocktake/sessions/${detail.id}/items`, {
				variantId: addVariantId,
				countedQuantity: Math.max(0, Number(addCount) || 0)
			})
			toast.success('Count added')
			addVariantId = ''
			addCount = '0'
			await openDetail(detail.id)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			adding = false
		}
	}

	async function saveCount(item: StocktakeItem, value: string) {
		if (!detail) return
		savingCount = { ...savingCount, [item.id]: true }
		try {
			await api.put(`/api/stocktake/sessions/${detail.id}/items/${item.id}`, {
				countedQuantity: Math.max(0, Number(value) || 0)
			})
			toast.success('Count saved')
			await openDetail(detail.id)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			savingCount = { ...savingCount, [item.id]: false }
		}
	}

	async function submit() {
		if (!detail) return
		busy = 'submit'
		try {
			await api.post(`/api/stocktake/sessions/${detail.id}/submit`, {})
			toast.success('Submitted for approval')
			await openDetail(detail.id)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busy = ''
		}
	}

	async function approve() {
		if (!detail) return
		if (!confirm(`Approve this stocktake? Variances will be applied to stock.`)) return
		busy = 'approve'
		try {
			await api.post(`/api/stocktake/sessions/${detail.id}/approve`, {})
			toast.success('Variances applied')
			await openDetail(detail.id)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			busy = ''
		}
	}

	const varianceOf = (it: StocktakeItem) =>
		it.countedQuantity == null ? null : it.countedQuantity - it.systemQuantity
	const totalVariance = $derived(detail?.items.reduce((s, it) => s + (varianceOf(it) ?? 0), 0) ?? 0)
</script>

<svelte:head>
	<title>Stocktake — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Stocktake</h1>
			<p class="mt-1 text-body-sm text-secondary">Draft counts → submit → approve applies variances with audit logs.</p>
		</div>
		<div class="flex gap-2">
			<a href="/inventory" class="inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-secondary hover:bg-surface-container">Back to inventory</a>
			{#if canWrite()}
				<Button onclick={openNew}><Icon name="add" size="text-[18px]" /> New session</Button>
			{/if}
		</div>
	</div>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(5) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if sessions.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="fact_check" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No stocktake sessions yet.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
						<tr>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Session</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Warehouse</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Items</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
						</tr>
					</thead>
					<tbody>
						{#each sessions as s (s.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<button class="font-mono-label text-mono-label font-medium text-primary hover:underline" onclick={() => openDetail(s.id)}>#{s.id.slice(0, 8).toUpperCase()}</button>
									{#if s.notes}<p class="text-xs text-secondary">{s.notes}</p>{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{s.warehouseName ?? 'Global'}</td>
								<td class="px-table-cell-x py-table-cell-y"><span class="rounded-full bg-secondary/10 px-2 py-0.5 text-xs capitalize text-secondary">{s.status}</span></td>
								<td class="px-table-cell-x py-table-cell-y text-right font-medium text-on-surface">{number(s.itemCount)}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(s.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
</div>

{#if showNew && canWrite()}
	<Modal title="New stocktake session" open={true} width="md" onClose={() => (showNew = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); createSession() }}>
			<div>
				<label for="st-wh" class="field-label">Warehouse (optional — leave empty for global count)</label>
				<select id="st-wh" class="field" bind:value={fWarehouse}>
					<option value="">Global (all stock)</option>
					{#each warehouses as w (w.id)}<option value={w.id}>{w.name} ({w.code})</option>{/each}
				</select>
			</div>
			<div>
				<label for="st-notes" class="field-label">Notes</label>
				<textarea id="st-notes" class="field h-20 w-full" bind:value={fNotes} placeholder="e.g. Monthly cycle count"></textarea>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (showNew = false)}>Cancel</Button>
				<Button type="submit" loading={creating}>Create draft</Button>
			</div>
		</form>
	</Modal>
{/if}

{#if detailLoading}
	<Modal title="Stocktake session" open={true} width="xl" onClose={() => (detail = null)}>
		<div class="space-y-2 py-4">
			{#each Array(4) as _}<div class="h-10 animate-pulse rounded bg-surface-container"></div>{/each}
		</div>
	</Modal>
{:else if detail}
	<Modal title={`Stocktake #${detail.id.slice(0, 8).toUpperCase()} — ${detail.status}`} open={true} width="xl" onClose={() => (detail = null)}>
		<div class="space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-2 text-sm">
				<p class="text-secondary">Scope: <span class="font-medium text-on-surface">{detail.warehouseId ? 'Warehouse' : 'Global'}</span> · {number(detail.items.length)} lines</p>
				<p class="text-secondary">Total variance: <span class="font-semibold" class:text-success={totalVariance > 0} class:text-error={totalVariance < 0}>{totalVariance > 0 ? `+${totalVariance}` : totalVariance}</span></p>
			</div>
			{#if detail.items.length === 0}
				<p class="py-6 text-center text-sm text-secondary">No counts yet — add the first item below.</p>
			{:else}
				<div class="max-h-[45vh] overflow-auto rounded border border-outline-variant">
					<table class="w-full text-left text-sm">
						<thead class="font-table-header text-table-header uppercase tracking-wider text-secondary">
							<tr>
								<th class="px-table-cell-x py-table-cell-y font-semibold">Product</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">System</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Counted</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Variance</th>
								<th class="px-table-cell-x py-table-cell-y text-right font-semibold"></th>
							</tr>
						</thead>
						<tbody>
							{#each detail.items as it (it.id)}
								{@const v = varianceOf(it)}
								<tr class="border-t border-outline-variant/60">
									<td class="px-table-cell-x py-table-cell-y">
										<p class="font-medium text-on-surface">{it.productName}</p>
										<p class="text-xs text-secondary">{it.sku ?? it.variantId.slice(0, 8)}</p>
									</td>
									<td class="px-table-cell-x py-table-cell-y text-right text-on-surface-variant">{number(it.systemQuantity)}</td>
									<td class="px-table-cell-x py-table-cell-y text-right">
										{#if detail.status === 'draft' && canWrite()}
											<input class="field w-24 text-right" type="number" min="0" value={it.countedQuantity ?? ''} placeholder="—" onchange={(e) => saveCount(it, (e.target as HTMLInputElement).value)} disabled={savingCount[it.id]} />
										{:else}
											<span class="font-medium text-on-surface">{it.countedQuantity ?? '—'}</span>
										{/if}
									</td>
									<td class="px-table-cell-x py-table-cell-y text-right font-semibold" class:text-success={(v ?? 0) > 0} class:text-error={(v ?? 0) < 0}>{v == null ? '—' : v > 0 ? `+${v}` : v}</td>
									<td class="px-table-cell-x py-table-cell-y text-right text-xs text-secondary">{savingCount[it.id] ? 'Saving…' : ''}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if detail.status === 'draft' && canWrite()}
				<div class="flex flex-wrap items-center gap-2 border-t border-outline-variant/60 pt-3">
					<select class="field max-w-xs" bind:value={addVariantId}>
						<option value="" disabled>Select item to count…</option>
						{#each variants as v (v.id)}
							<option value={v.id}>{v.productName}{v.sku ? ` (${v.sku})` : ''} — sys {v.inventory}</option>
						{/each}
					</select>
					<input class="field w-24" type="number" min="0" bind:value={addCount} aria-label="Counted quantity" />
					<Button size="sm" loading={adding} onclick={addItem}>Add count</Button>
				</div>
				<div class="flex justify-end gap-2 pt-1">
					<Button variant="secondary" size="sm" loading={busy === 'submit'} onclick={submit}>Submit for approval</Button>
				</div>
			{:else if detail.status === 'submitted' && canWrite()}
				<div class="flex justify-end gap-2 pt-1">
					<Button size="sm" loading={busy === 'approve'} onclick={approve}>Approve & apply variances</Button>
				</div>
			{/if}
		</div>
	</Modal>
{/if}
