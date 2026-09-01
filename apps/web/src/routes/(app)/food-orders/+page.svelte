<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { dateTime } from '$lib/format'
	import type { FoodOrder, MenuItem, MenuModifierGroup, MenuProductLite } from '$lib/types'

	const canWrite = $derived(session.can('orders.create') || session.can('orders.update'))

	const TYPE_OPTIONS = [
		{ value: 'DINE_IN', label: 'Dine-in' },
		{ value: 'TAKEAWAY', label: 'Takeaway' },
		{ value: 'DELIVERY', label: 'Delivery' },
		{ value: 'QR', label: 'QR' },
		{ value: 'SCHEDULED', label: 'Scheduled' }
	]

	const NEXT_STATUS: Record<string, string | null> = {
		CREATED: 'CONFIRMED',
		CONFIRMED: 'PREPARING',
		PREPARING: 'READY',
		READY: 'COMPLETED',
		COMPLETED: null,
		CANCELLED: null
	}

	const STATUS_TONE: Record<string, string> = {
		CREATED: 'bg-secondary/10 text-secondary ring-secondary',
		CONFIRMED: 'bg-info/10 text-info ring-info',
		PREPARING: 'bg-warning/10 text-warning ring-warning',
		READY: 'bg-primary/10 text-primary ring-primary',
		COMPLETED: 'bg-success/10 text-success ring-success',
		CANCELLED: 'bg-error/10 text-error ring-error'
	}

	let items = $state<FoodOrder[]>([])
	let loading = $state(true)
	let type = $state('')
	let status = $state('')

	let selected = $state<FoodOrder | null>(null)
	let showNew = $state(false)

	// New-order form
	let outlets = $state<{ id: string; name: string }[]>([])
	let newType = $state('DINE_IN')
	let newOutlet = $state('')
	let stock = $state<MenuProductLite[]>([])
	let stockGroups = $state<MenuModifierGroup[]>([])
	let orderLines = $state<{ menuItemId: string; name: string; quantity: number; modifiers: { id: string; name: string; price: number }[] }[]>([])
	let stockPick = $state('')
	let stockQty = $state('1')

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = {}
			if (type) params.orderType = type
			if (status) params.status = status
			const res = await api.get<{ success: boolean; data: { items: FoodOrder[] } }>('/api/food-orders', params)
			items = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function openDetail(id: string) {
		try {
			const res = await api.get<{ success: boolean; data: FoodOrder }>(`/api/food-orders/${id}`)
			selected = res.data
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function advance() {
		if (!selected) return
		const next = NEXT_STATUS[selected.status]
		if (!next) return
		try {
			await api.post<{ success: boolean }>(`/api/food-orders/${selected.id}/status`, { status: next })
			toast.success(`Marked as ${next.toLowerCase()}`)
			openDetail(selected.id)
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function cancel() {
		if (!selected) return
		if (!confirm(`Cancel order ${selected.orderNumber}?`)) return
		try {
			await api.post<{ success: boolean }>(`/api/food-orders/${selected.id}/cancel`)
			toast.success('Order cancelled')
			openDetail(selected.id)
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function openNew() {
		showNew = true
		orderLines = []
		stockPick = ''
		try {
			const o = await api.get<{ success: boolean; data: { id: string; name: string }[] }>('/api/outlets')
			outlets = o.data
			newOutlet = newOutlet || (o.data[0]?.id ?? '')
		} catch (e) {
			toast.error((e as Error).message)
		}
		await loadStock()
	}

	async function loadStock() {
		try {
			const s = await api.get<{ success: boolean; data: { items: MenuItem[] } }>('/api/menu', { limit: '100' })
			stock = s.data.items.map((m) => ({
				id: m.id,
				name: m.product.name,
				sku: m.product.sku ?? '',
				price: m.product.price,
				status: m.status
			}))
			const g = await api.get<{ success: boolean; data: MenuModifierGroup[] }>('/api/modifier-groups')
			stockGroups = g.data
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function addLine() {
		if (!stockPick) return toast.error('Pick an item')
		const menu = stock.find((s) => s.id === stockPick)
		if (!menu) return
		const item = stockGroups.find((g) => g.name === 'Add Ons')
		const firstMod = item?.modifiers[0]
		const mods = firstMod ? [{ id: firstMod.id, name: firstMod.name, price: Number(firstMod.priceAdjustment) }] : []
		orderLines = [...orderLines, { menuItemId: menu.id, name: menu.name, quantity: Number(stockQty) || 1, modifiers: mods }]
		stockPick = ''
		stockQty = '1'
	}

	function removeLine(i: number) {
		orderLines.splice(i, 1)
	}

	function linePrice(line: (typeof orderLines)[number]) {
		const menu = stock.find((s) => s.id === line.menuItemId)
		const base = menu ? Number(menu.price) : 0
		const mods = line.modifiers.reduce((a, m) => a + m.price, 0)
		return Math.round((base + mods) * line.quantity * 100) / 100
	}

	async function createOrder() {
		if (orderLines.length === 0) return toast.error('Add at least one item')
		if (!newOutlet) return toast.error('Pick an outlet')
		try {
			await api.post<{ success: boolean }>('/api/food-orders', {
				orderType: newType,
				outletId: newOutlet,
				items: orderLines.map((l) => ({
					menuItemId: l.menuItemId,
					quantity: l.quantity,
					modifiers: l.modifiers.length ? l.modifiers.map((m) => ({ modifierId: m.id })) : undefined
				}))
			})
			toast.success('Food order created')
			showNew = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(load)
</script>

<svelte:head><title>Food Orders — Merchant OS</title></svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Food Orders</h1>
			<p class="mt-1 text-body-sm text-secondary">Dine-in, takeaway, delivery and scheduled orders across outlets.</p>
		</div>
		{#if canWrite}
			<Button onclick={openNew}><Icon name="add" size="text-[18px]" /> New order</Button>
		{/if}
	</div>

	<Card>
		<div class="mb-4 flex flex-wrap items-center gap-3">
			<select bind:value={type} onchange={load} class="field w-auto">
				<option value="">All types</option>
				{#each TYPE_OPTIONS as t}
					<option value={t.value}>{t.label}</option>
				{/each}
			</select>
			<select bind:value={status} onchange={load} class="field w-auto">
				<option value="">All statuses</option>
				{#each Object.keys(NEXT_STATUS) as s}
					<option value={s}>{s.toLowerCase()}</option>
				{/each}
			</select>
			<span class="text-sm text-secondary">{items.length} order{items.length === 1 ? '' : 's'}</span>
		</div>

		{#if loading}
			<div class="py-10 text-center text-sm text-secondary">Loading orders…</div>
		{:else if items.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="ramen_dining" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No food orders yet.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
						<tr>
							<th class="py-2 pr-4 font-semibold">Order</th>
							<th class="py-2 pr-4 font-semibold">Type</th>
							<th class="py-2 pr-4 font-semibold">Outlet</th>
							<th class="py-2 pr-4 font-semibold">Total</th>
							<th class="py-2 pr-4 font-semibold">Status</th>
							<th class="py-2 pr-4 font-semibold">Placed</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-outline-variant/60">
						{#each items as order (order.id)}
							<tr onclick={() => openDetail(order.id)} class="cursor-pointer transition-colors hover:bg-surface-container-low">
								<td class="py-3 pr-4 font-mono-label text-mono-label font-medium text-on-surface">{order.orderNumber}</td>
								<td class="py-3 pr-4 text-on-surface-variant">{order.orderType}</td>
								<td class="py-3 pr-4 text-on-surface-variant">{order.outletName ?? '—'}</td>
								<td class="py-3 pr-4 font-mono-label text-mono-label text-on-surface">${Number(order.total).toFixed(2)}</td>
								<td class="py-3 pr-4">
									<span class={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[order.status]}`}>{order.status}</span>
								</td>
								<td class="py-3 pr-4 text-secondary">{dateTime(order.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
</div>

{#if selected}
	<Modal open={true} title={`Order ${selected.orderNumber}`} onClose={() => (selected = null)}>
		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<span class={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[selected.status]}`}>{selected.status}</span>
					<span class="text-sm text-secondary">{selected.orderType} · {selected.outletName ?? '—'}</span>
				</div>
				<div class="flex gap-2">
					{#if canWrite}
						{#if NEXT_STATUS[selected.status]}
							<Button onclick={advance}>Mark {NEXT_STATUS[selected.status]!.toLowerCase()}</Button>
						{/if}
						{#if selected.status === 'CREATED' || selected.status === 'CONFIRMED'}
							<Button variant="danger" onclick={cancel}>Cancel</Button>
						{/if}
					{/if}
				</div>
			</div>

			<div class="divide-y divide-outline-variant/60 rounded border border-outline-variant">
				{#each selected.items as line (line.id)}
					<div class="flex items-center justify-between p-3">
						<div>
							<div class="font-medium text-on-surface">{line.quantity}× {line.name}</div>
							{#if line.modifiers.length}
								<div class="mt-0.5 text-xs text-on-surface-variant">
									{#each line.modifiers as m}{m.name}{m.quantity > 1 ? ` ×${m.quantity}` : ''} · {/each}
								</div>
							{/if}
						</div>
						<div class="font-mono-label text-mono-label text-on-surface">${Number(line.total).toFixed(2)}</div>
					</div>
				{/each}
			</div>

			<div class="space-y-1 text-sm">
				<div class="flex justify-between text-secondary"><span>Subtotal</span><span class="text-on-surface-variant">${Number(selected.subtotal).toFixed(2)}</span></div>
				<div class="flex justify-between text-secondary"><span>Tax</span><span class="text-on-surface-variant">${Number(selected.taxTotal).toFixed(2)}</span></div>
				<div class="flex justify-between font-semibold text-on-surface"><span>Total</span><span>${Number(selected.total).toFixed(2)}</span></div>
			</div>

			{#if selected.notes}
				<div class="rounded border border-outline-variant bg-surface-container-low p-3 text-sm text-on-surface-variant">"{selected.notes}"</div>
			{/if}
			<p class="text-xs text-outline">Placed {dateTime(selected.createdAt)}</p>
		</div>
	</Modal>
{/if}

{#if showNew && canWrite}
	<Modal open={true} title="New food order" onClose={() => (showNew = false)}>
		<div class="space-y-4">
			<div class="flex gap-4">
				<div class="flex-1">
					<label for="fo-type" class="field-label">Type</label>
					<select id="fo-type" class="field" bind:value={newType}>
						{#each TYPE_OPTIONS as t}
							<option value={t.value}>{t.label}</option>
						{/each}
					</select>
				</div>
				<div class="flex-1">
					<label for="fo-outlet" class="field-label">Outlet</label>
					<select id="fo-outlet" class="field" bind:value={newOutlet}>
						{#each outlets as o (o.id)}
							<option value={o.id}>{o.name}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="flex items-end gap-2">
				<div class="flex-1">
					<label for="fo-item" class="field-label">Item</label>
					<select id="fo-item" class="field" bind:value={stockPick}>
						<option value="" disabled>Select item</option>
						{#each stock as s (s.id)}
							<option value={s.id}>{s.name} — ${Number(s.price).toFixed(2)}</option>
						{/each}
					</select>
				</div>
				<div class="w-20">
					<label for="fo-qty" class="field-label">Qty</label>
					<input id="fo-qty" class="field" bind:value={stockQty} type="number" min="1" />
				</div>
				<Button variant="secondary" onclick={addLine} disabled={!stockPick}>Add</Button>
			</div>

			{#if orderLines.length}
				<div class="space-y-2">
					{#each orderLines as line, i (line.menuItemId + i)}
						<div class="flex items-center justify-between rounded border border-outline-variant bg-surface-container-lowest p-2 text-sm">
							<span class="text-on-surface-variant">{line.quantity}× {line.name}{line.modifiers.length ? ` +${line.modifiers.map((m) => m.name).join(', ')}` : ''}</span>
							<span class="flex items-center gap-3">
								<span class="font-mono-label text-mono-label text-on-surface">${linePrice(line).toFixed(2)}</span>
								<button onclick={() => removeLine(i)} class="rounded p-1.5 text-xs text-error hover:bg-error-container/40">Remove</button>
							</span>
						</div>
					{/each}
					<div class="flex justify-end pt-2">
						<Button onclick={createOrder} disabled={orderLines.length === 0}>Create order</Button>
					</div>
				</div>
			{/if}
		</div>
	</Modal>
{/if}
