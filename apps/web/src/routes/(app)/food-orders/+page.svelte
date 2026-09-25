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
	import type { FoodOrder, MenuItem, MenuModifierGroup } from '$lib/types'

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
	let menuItems = $state<MenuItem[]>([])
	let orderLines = $state<{ menuItemId: string; name: string; quantity: number; modifiers: { id: string; name: string; price: number }[] }[]>([])
	let stockPick = $state('')
	let stockQty = $state('1')
	// modifier choices for the currently picked item (modifierId set)
	let lineChoice = $state<Map<string, number>>(new Map())

	// Embedded pay step: after the order is created the same modal collects
	// payment (method + cash tender) via the existing pay endpoint.
	let createdOrder = $state<FoodOrder | null>(null)
	let payMethod = $state('cash')
	let cashReceived = $state<number | null>(null)
	let paying = $state(false)
	let creating = $state(false)

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
		createdOrder = null
		orderLines = []
		stockPick = ''
		lineChoice = new Map()
		payMethod = 'cash'
		cashReceived = null
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
			menuItems = s.data.items
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	/** Modifier groups of the currently picked menu item. */
	function pickedGroups(): MenuModifierGroup[] {
		const item = menuItems.find((m) => m.id === stockPick)
		return item?.modifierGroups ?? []
	}

	function pickItem(id: string) {
		stockPick = id
		lineChoice = new Map()
	}

	function toggleLineModifier(group: MenuModifierGroup, modId: string) {
		const next = new Map(lineChoice)
		if (next.has(modId)) {
			next.delete(modId)
		} else {
			const inGroup = group.modifiers.filter((m) => next.has(m.id)).length
			if (group.maxSelections > 0 && inGroup >= group.maxSelections) {
				toast.error(`Up to ${group.maxSelections} option${group.maxSelections === 1 ? '' : 's'} in ${group.name}`)
				return
			}
			next.set(modId, 1)
		}
		lineChoice = next
	}

	function groupHint(group: MenuModifierGroup) {
		const min = group.required ? Math.max(1, group.minSelections || 0) : group.minSelections || 0
		const parts: string[] = [group.required ? 'Required' : 'Optional']
		if (min > 0) parts.push(`min ${min}`)
		if (group.maxSelections > 0) parts.push(`max ${group.maxSelections}`)
		return parts.join(' · ')
	}

	function addLine() {
		if (!stockPick) return toast.error('Pick an item')
		const item = menuItems.find((m) => m.id === stockPick)
		if (!item) return
		// Validate required / minimum selections before the line is added.
		for (const g of item.modifierGroups ?? []) {
			const min = g.required ? Math.max(1, g.minSelections || 0) : g.minSelections || 0
			const count = g.modifiers.filter((m) => lineChoice.has(m.id)).length
			if (count < min) {
				return toast.error(
					`${g.name}: pick at least ${min} option${min === 1 ? '' : 's'} (${groupHint(g)})`
				)
			}
		}
		const mods = [...lineChoice.keys()].flatMap((id) => {
			for (const g of item.modifierGroups ?? []) {
				const m = g.modifiers.find((x) => x.id === id)
				if (m) return [{ id: m.id, name: m.name, price: Number(m.priceAdjustment) }]
			}
			return []
		})
		orderLines = [...orderLines, { menuItemId: item.id, name: item.product.name, quantity: Number(stockQty) || 1, modifiers: mods }]
		stockPick = ''
		stockQty = '1'
		lineChoice = new Map()
	}

	function removeLine(i: number) {
		orderLines.splice(i, 1)
	}

	function linePrice(line: (typeof orderLines)[number]) {
		const item = menuItems.find((m) => m.id === line.menuItemId)
		const base = item ? Number(item.product.price) : 0
		const mods = line.modifiers.reduce((a, m) => a + m.price, 0)
		return Math.round((base + mods) * line.quantity * 100) / 100
	}

	function draftTotal() {
		return Math.round(orderLines.reduce((a, l) => a + linePrice(l), 0) * 100) / 100
	}

	async function createOrder() {
		if (orderLines.length === 0) return toast.error('Add at least one item')
		if (!newOutlet) return toast.error('Pick an outlet')
		if (creating) return
		creating = true
		try {
			const res = await api.post<{ success: boolean; data: FoodOrder }>('/api/food-orders', {
				orderType: newType,
				outletId: newOutlet,
				items: orderLines.map((l) => ({
					menuItemId: l.menuItemId,
					quantity: l.quantity,
					modifiers: l.modifiers.length ? l.modifiers.map((m) => ({ modifierId: m.id })) : undefined
				}))
			})
			createdOrder = res.data
			toast.success(`Order ${res.data.orderNumber} created — collect payment`)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			creating = false
		}
	}

	async function payCreated() {
		if (!createdOrder) return
		if (payMethod === 'cash' && cashReceived !== null && cashReceived < Number(createdOrder.total)) {
			return toast.error('Cash received is less than the total')
		}
		if (paying) return
		paying = true
		try {
			const res = await api.post<{ success: boolean; data: FoodOrder }>(`/api/food-orders/${createdOrder.id}/pay`, {
				paymentMethod: payMethod,
				...(payMethod === 'cash' && cashReceived !== null ? { cashReceived } : {})
			})
			createdOrder = res.data
			toast.success(res.data.paymentStatus === 'paid' ? 'Payment completed' : 'Payment recorded')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			paying = false
		}
	}

	function closeNew() {
		showNew = false
		createdOrder = null
		orderLines = []
		load()
	}

	onMount(load)
</script>

<svelte:head><title>Food Orders — JamiCore</title></svelte:head>

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
	<Modal open={true} title={createdOrder ? `Pay order ${createdOrder.orderNumber}` : 'New food order'} onClose={closeNew}>
		<div class="space-y-4">
			{#if !createdOrder}
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
						<select id="fo-item" class="field" value={stockPick} onchange={(e) => pickItem(e.currentTarget.value)}>
							<option value="" disabled>Select item</option>
							{#each menuItems as m (m.id)}
								<option value={m.id}>{m.product.name} — ${Number(m.product.price).toFixed(2)}</option>
							{/each}
						</select>
					</div>
					<div class="w-20">
						<label for="fo-qty" class="field-label">Qty</label>
						<input id="fo-qty" class="field" bind:value={stockQty} type="number" min="1" />
					</div>
					<Button variant="secondary" onclick={addLine} disabled={!stockPick}>Add</Button>
				</div>

				{#if stockPick && pickedGroups().length > 0}
					<div class="space-y-3 rounded border border-outline-variant bg-surface-container-low p-3">
						{#each pickedGroups() as g (g.id)}
							<div>
								<div class="mb-1.5 flex items-center justify-between">
									<span class="text-sm font-medium text-on-surface">{g.name}</span>
									<span class="text-xs text-secondary">{groupHint(g)}</span>
								</div>
								<div class="flex flex-wrap gap-1.5">
									{#each g.modifiers as m (m.id)}
										<button
											type="button"
											class="rounded-full px-3 py-1 text-xs font-medium transition-colors {lineChoice.has(m.id) ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}"
											onclick={() => toggleLineModifier(g, m.id)}
											disabled={!m.available || m.status !== 'active'}
											title={Number(m.priceAdjustment) ? `+${Number(m.priceAdjustment).toFixed(2)}` : 'No charge'}
										>
											{m.name}{Number(m.priceAdjustment) ? ` +${Number(m.priceAdjustment).toFixed(2)}` : ''}
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}

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
						<div class="flex items-center justify-between pt-1 text-sm">
							<span class="text-secondary">Draft total (before tax)</span>
							<span class="font-mono-label text-mono-label font-semibold text-on-surface">${draftTotal().toFixed(2)}</span>
						</div>
						<div class="flex justify-end pt-1">
							<Button onclick={createOrder} loading={creating} disabled={creating || orderLines.length === 0}>Create & pay</Button>
						</div>
					</div>
				{/if}
			{:else}
				<div class="space-y-3 rounded border border-outline-variant bg-surface-container-low p-3 text-sm">
					<div class="flex items-center justify-between">
						<span class="text-secondary">Total due</span>
						<span class="font-mono-label text-mono-label font-semibold text-on-surface">${Number(createdOrder.total).toFixed(2)}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-secondary">Payment</span>
						<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {createdOrder.paymentStatus === 'paid' ? 'bg-success/10 text-success ring-success' : 'bg-warning/10 text-warning ring-warning'}">
							{createdOrder.paymentStatus}
						</span>
					</div>
				</div>
				{#if createdOrder.paymentStatus !== 'paid'}
					<div>
						<label for="fo-pay-method" class="field-label">Payment method</label>
						<select id="fo-pay-method" class="field" bind:value={payMethod}>
							<option value="cash">Cash</option>
							<option value="card">Card</option>
							<option value="bank_transfer">Bank transfer</option>
							<option value="wallet">Wallet</option>
							<option value="gift_card">Gift card</option>
						</select>
					</div>
					{#if payMethod === 'cash'}
						<div>
							<label for="fo-cash" class="field-label">Cash tendered</label>
							<input
								id="fo-cash"
								type="number"
								inputmode="decimal"
								min={Number(createdOrder.total)}
								step="0.01"
								class="field"
								bind:value={cashReceived}
								placeholder={Number(createdOrder.total).toFixed(2)}
							/>
							{#if cashReceived !== null && cashReceived >= Number(createdOrder.total)}
								<p class="mt-1 text-sm text-on-surface-variant">
									Change: ${(cashReceived - Number(createdOrder.total)).toFixed(2)}
								</p>
							{/if}
						</div>
					{/if}
					<div class="flex justify-end gap-2 pt-1">
						<Button variant="secondary" onclick={closeNew}>Pay later</Button>
						<Button onclick={payCreated} loading={paying} disabled={paying}>Collect ${Number(createdOrder.total).toFixed(2)}</Button>
					</div>
				{:else}
					<div class="flex justify-end pt-1">
						<Button onclick={closeNew}>Done</Button>
					</div>
				{/if}
			{/if}
		</div>
	</Modal>
{/if}
