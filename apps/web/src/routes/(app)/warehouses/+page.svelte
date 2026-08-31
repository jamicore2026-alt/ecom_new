<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { currency, number } from '$lib/format'
	import type { Address, Warehouse, WarehouseInventory } from '$lib/types'

	const canWrite = () => session.can('inventory:write')

	let warehouses = $state<Warehouse[]>([])
	let loading = $state(true)
	let loadingStats = $state(false)

	let inventoryMap = $state<Record<string, WarehouseInventory>>({})

	let selected = $state<Warehouse | null>(null)

	let showCreate = $state(false)
	let editing = $state<Warehouse | null>(null)
	let fName = $state('')
	let fCode = $state('')
	let fDefault = $state(false)
	let fAddr = $state<Address>({})
	let saving = $state(false)

	const totalWarehouses = $derived(warehouses.length)
	const totalSku = $derived(Object.values(inventoryMap).reduce((s, inv) => s + inv.skuCount, 0))
	const totalValue = $derived(Object.values(inventoryMap).reduce((s, inv) => s + inv.stockValue, 0))
	const totalQty = $derived(Object.values(inventoryMap).reduce((s, inv) => s + inv.items.reduce((q, it) => q + it.quantity, 0), 0))

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Warehouse[] } }>('/api/warehouses')
			warehouses = res.data.items
			await loadStats()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function loadStats() {
		loadingStats = true
		inventoryMap = {}
		try {
			const entries = await Promise.all(
				warehouses.map(async (w) => {
					const inv = await api.get<{ success: boolean; data: WarehouseInventory }>(`/api/warehouses/${w.id}/inventory`)
					return [w.id, inv.data] as const
				})
			)
			inventoryMap = Object.fromEntries(entries)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loadingStats = false
		}
	}

	onMount(load)

	function openCreate() {
		editing = null
		fName = ''
		fCode = ''
		fDefault = !warehouses.some((w) => w.isDefault)
		fAddr = {}
		showCreate = true
	}

	function openEdit(w: Warehouse) {
		editing = w
		fName = w.name
		fCode = w.code
		fDefault = w.isDefault
		fAddr = { ...w.address }
		showCreate = true
	}

	async function save() {
		if (!fName.trim() || !fCode.trim()) return toast.error('Name and code are required')
		saving = true
		try {
			const body = { name: fName.trim(), code: fCode.trim(), isDefault: fDefault, address: fAddr }
			if (editing) {
				await api.put<{ success: boolean }>(`/api/warehouses/${editing.id}`, body)
				toast.success('Warehouse updated')
			} else {
				await api.post<{ success: boolean }>('/api/warehouses', body)
				toast.success('Warehouse created')
			}
			showCreate = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	const addressLine = (a: Address | null | undefined) => {
		if (!a) return 'No address'
		const parts = [a.city, a.state, a.country].filter(Boolean)
		return parts.length ? parts.join(', ') : 'No address'
	}
</script>

<svelte:head>
	<title>Warehouses — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Warehouses</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage and monitor inventory locations across your network.</p>
		</div>
		{#if canWrite()}
			<Button onclick={openCreate}><Icon name="add" size="text-[18px]" /> Add warehouse</Button>
		{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<Card>
			<div class="flex items-center justify-between">
				<p class="text-sm text-secondary">Total warehouses</p>
				<Icon name="warehouse" size="text-[18px]" class="text-primary" />
			</div>
			<p class="mt-1 font-display text-2xl text-on-surface">{number(totalWarehouses)}</p>
		</Card>
		<Card>
			<div class="flex items-center justify-between">
				<p class="text-sm text-secondary">Active SKUs</p>
				<Icon name="inventory_2" size="text-[18px]" class="text-primary" />
			</div>
			<p class="mt-1 font-display text-2xl text-on-surface">{loadingStats ? '…' : number(totalSku)}</p>
		</Card>
		<Card>
			<div class="flex items-center justify-between">
				<p class="text-sm text-secondary">Total stock value</p>
				<Icon name="payments" size="text-[18px]" class="text-success" />
			</div>
			<p class="mt-1 font-display text-2xl text-on-surface">{loadingStats ? '…' : currency(totalValue)}</p>
		</Card>
		<Card>
			<div class="flex items-center justify-between">
				<p class="text-sm text-secondary">Units on hand</p>
				<Icon name="all_inbox" size="text-[18px]" class="text-warning" />
			</div>
			<p class="mt-1 font-display text-2xl text-on-surface">{loadingStats ? '…' : number(totalQty)}</p>
		</Card>
	</div>

	{#if loading}
		<div class="py-10 text-center text-sm text-secondary">Loading warehouses…</div>
	{:else if warehouses.length === 0}
		<Card>
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="warehouse" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No warehouses yet. Add one to start managing locations.</p>
			</div>
		</Card>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each warehouses as w (w.id)}
				<Card>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<h2 class="truncate font-semibold text-on-surface">{w.name}</h2>
								{#if w.isDefault}<span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Default</span>{/if}
							</div>
							<p class="mt-1 flex items-center gap-1 text-xs text-secondary">
								<Icon name="location_on" size="text-[14px]" />
								{addressLine(w.address)}
							</p>
						</div>
						<Badge label={w.status} />
					</div>
					<div class="mt-4 grid grid-cols-2 gap-2 rounded border border-outline-variant/60 bg-surface-container-lowest p-3 text-sm">
						<div>
							<p class="text-xs text-secondary">SKU count</p>
							<p class="font-medium text-on-surface">{number(inventoryMap[w.id]?.skuCount ?? 0)}</p>
						</div>
						<div class="text-right">
							<p class="text-xs text-secondary">Stock value</p>
							<p class="font-mono-label text-mono-label font-medium text-on-surface">{currency(inventoryMap[w.id]?.stockValue ?? 0)}</p>
						</div>
					</div>
					<div class="mt-3 flex items-center justify-end gap-1">
						<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => (selected = w)}>View stock</button>
						{#if canWrite()}
							<button class="rounded p-1.5 text-xs font-medium text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => openEdit(w)}>Edit</button>
						{/if}
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>

{#if selected}
	<Modal title={`${selected.name} — stock`} open={true} onClose={() => (selected = null)} width="lg">
		{#if !inventoryMap[selected.id]}
			<div class="py-10 text-center text-sm text-secondary">Loading stock…</div>
		{:else if inventoryMap[selected.id].items.length === 0}
			<div class="flex flex-col items-center gap-2 py-14 text-center">
				<Icon name="inventory_2" size="text-[28px]" class="text-outline" />
				<p class="text-sm text-secondary">No stock recorded in this warehouse.</p>
			</div>
		{:else}
			<div class="mb-3 flex items-center justify-between text-sm">
				<span class="text-secondary">{number(inventoryMap[selected.id].skuCount)} SKUs</span>
				<span class="font-mono-label text-mono-label font-medium text-on-surface">{currency(inventoryMap[selected.id].stockValue)}</span>
			</div>
			<div class="max-h-[50vh] overflow-auto">
				<table class="w-full text-left text-sm">
					<thead class="font-table-header text-table-header uppercase tracking-wider text-secondary">
						<tr>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Product</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Variant</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">SKU</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Qty</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Value</th>
						</tr>
					</thead>
					<tbody>
						{#each inventoryMap[selected.id].items as it (it.id)}
							<tr class="border-t border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<a href="/products/{it.productId}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">{it.productName}</a>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">
									{#if Object.keys(it.optionValues).length}
										{Object.entries(it.optionValues).map(([k, v]) => `${k}: ${v}`).join(', ')}
									{:else}
										<span class="text-outline">Default</span>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{it.sku ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-right font-medium text-on-surface" class:text-error={it.quantity === 0}>{number(it.quantity)}</td>
								<td class="px-table-cell-x py-table-cell-y text-right font-mono-label text-mono-label text-on-surface">{currency(it.quantity * it.price)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Modal>
{/if}

{#if showCreate && canWrite()}
	<Modal title={editing ? `Edit ${editing.name}` : 'Add warehouse'} open={true} width="md" onClose={() => (showCreate = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); save() }}>
			<div>
				<label for="wh-name" class="field-label">Name *</label>
				<input id="wh-name" class="field" bind:value={fName} placeholder="e.g. Alpha Distribution Center" required />
			</div>
			<div>
				<label for="wh-code" class="field-label">Code *</label>
				<input id="wh-code" class="field uppercase" bind:value={fCode} placeholder="e.g. WH-01" maxlength="30" required />
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<input class="field" placeholder="City" bind:value={fAddr.city} />
				<input class="field" placeholder="State" bind:value={fAddr.state} />
				<input class="field" placeholder="Country" bind:value={fAddr.country} />
				<input class="field" placeholder="Postal code" bind:value={fAddr.postalCode} />
			</div>
			<label class="flex items-center gap-2 text-sm text-on-surface-variant">
				<input type="checkbox" class="field-check" bind:checked={fDefault} />
				Set as default warehouse
			</label>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (showCreate = false)}>Cancel</Button>
				<Button type="submit" loading={saving}>{editing ? 'Save' : 'Create'}</Button>
			</div>
		</form>
	</Modal>
{/if}
