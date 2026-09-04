<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import { dateTimeFull, timeAgo } from '$lib/format'

	type FulfillmentStatus =
		| 'unfulfilled'
		| 'processing'
		| 'packed'
		| 'shipped'
		| 'delivered'
		| 'failed'
		| 'returned'
		| 'cancelled'

	interface Fulfillment {
		id: string
		merchantId: string
		orderId: string
		orderNumber: string | null
		status: FulfillmentStatus | string
		carrier: string | null
		courierProvider: string | null
		trackingNumber: string | null
		trackingUrl: string | null
		labelUrl: string | null
		shippedAt: string | null
		deliveredAt: string | null
		cancelledAt: string | null
		createdAt: string
		updatedAt: string
	}

	const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
		{ value: '', label: 'All' },
		{ value: 'unfulfilled', label: 'Unfulfilled' },
		{ value: 'processing', label: 'Processing' },
		{ value: 'packed', label: 'Packed' },
		{ value: 'shipped', label: 'Shipped' },
		{ value: 'delivered', label: 'Delivered' },
		{ value: 'failed', label: 'Failed' },
		{ value: 'returned', label: 'Returned' },
		{ value: 'cancelled', label: 'Cancelled' }
	]

	const TRANSITION_HINTS: Record<string, string> = {
		unfulfilled: 'Next: processing',
		processing: 'Next: packed, cancelled, or failed',
		packed: 'Next: shipped or cancelled',
		shipped: 'Next: delivered, failed, or returned',
		failed: 'Next: processing',
		returned: '',
		cancelled: ''
	}

	let items = $state<Fulfillment[]>([])
	let total = $state(0)
	let loading = $state(true)
	let statusFilter = $state('')
	let saving = $state(false)

	const canRead = () => session.can('orders.read')
	const canWrite = () => session.can('orders:write')

	// Create modal
	let showCreate = $state(false)
	let createOrderId = $state('')
	let createCarrier = $state('')
	let createCourier = $state('')

	// Ship modal
	let showShip = $state(false)
	let shipTarget = $state<Fulfillment | null>(null)
	let shipTracking = $state('')
	let shipTrackingUrl = $state('')
	let shipLabelUrl = $state('')
	let shipCarrier = $state('')

	// Edit modal
	let showEdit = $state(false)
	let editTarget = $state<Fulfillment | null>(null)
	let editCarrier = $state('')
	let editCourier = $state('')
	let editTracking = $state('')
	let editTrackingUrl = $state('')
	let editLabelUrl = $state('')

	const canShipable = (s: string) =>
		s === 'unfulfilled' || s === 'processing' || s === 'packed'

	const canCancel = (s: string) =>
		s === 'unfulfilled' || s === 'processing' || s === 'packed'

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = {}
			if (statusFilter) params.status = statusFilter
			const res = await api.get<{ success: boolean; data: { items: Fulfillment[]; meta?: { page: number; limit: number; total: number } } }>(
				'/api/fulfillments',
				params
			)
			items = res.data.items ?? []
			total = res.data.meta?.total ?? items.length
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function applyFilter() {
		load()
	}

	// --- Create ---
	function openCreate() {
		createOrderId = ''
		createCarrier = ''
		createCourier = ''
		showCreate = true
	}

	async function createFulfillment() {
		if (!createOrderId.trim()) {
			toast.error('Order ID is required')
			return
		}
		saving = true
		try {
			await api.post<{ success: boolean; data: Fulfillment }>('/api/fulfillments', {
				orderId: createOrderId.trim(),
				...(createCarrier.trim() ? { carrier: createCarrier.trim() } : {}),
				...(createCourier.trim() ? { courierProvider: createCourier.trim() } : {})
			})
			toast.success('Fulfillment created')
			showCreate = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	// --- Ship ---
	function openShip(f: Fulfillment) {
		shipTarget = f
		shipTracking = f.trackingNumber ?? ''
		shipTrackingUrl = f.trackingUrl ?? ''
		shipLabelUrl = f.labelUrl ?? ''
		shipCarrier = f.carrier ?? ''
		showShip = true
	}

	async function submitShip() {
		if (!shipTarget) return
		saving = true
		try {
			await api.post<{ success: boolean; data: Fulfillment }>(`/api/fulfillments/${shipTarget.id}/ship`, {
				...(shipTracking.trim() ? { trackingNumber: shipTracking.trim() } : {}),
				...(shipTrackingUrl.trim() ? { trackingUrl: shipTrackingUrl.trim() } : {}),
				...(shipLabelUrl.trim() ? { labelUrl: shipLabelUrl.trim() } : {}),
				...(shipCarrier.trim() ? { carrier: shipCarrier.trim() } : {})
			})
			toast.success('Fulfillment shipped')
			showShip = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	// --- Cancel ---
	async function cancelFulfillment(f: Fulfillment) {
		if (!confirm(`Cancel fulfillment for order ${f.orderNumber ?? f.id.slice(0, 8).toUpperCase()}?`)) return
		try {
			await api.post<{ success: boolean; data: Fulfillment }>(`/api/fulfillments/${f.id}/cancel`)
			toast.success('Fulfillment cancelled')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	// --- Edit ---
	function openEdit(f: Fulfillment) {
		editTarget = f
		editCarrier = f.carrier ?? ''
		editCourier = f.courierProvider ?? ''
		editTracking = f.trackingNumber ?? ''
		editTrackingUrl = f.trackingUrl ?? ''
		editLabelUrl = f.labelUrl ?? ''
		showEdit = true
	}

	async function submitEdit() {
		if (!editTarget) return
		saving = true
		try {
			const body: Record<string, string> = {}
			if (editCarrier !== (editTarget.carrier ?? '')) body.carrier = editCarrier.trim()
			if (editCourier !== (editTarget.courierProvider ?? '')) body.courierProvider = editCourier.trim()
			if (editTracking !== (editTarget.trackingNumber ?? '')) body.trackingNumber = editTracking.trim()
			if (editTrackingUrl !== (editTarget.trackingUrl ?? '')) body.trackingUrl = editTrackingUrl.trim()
			if (editLabelUrl !== (editTarget.labelUrl ?? '')) body.labelUrl = editLabelUrl.trim()
			if (Object.keys(body).length === 0) {
				showEdit = false
				return
			}
			await api.put<{ success: boolean; data: Fulfillment }>(`/api/fulfillments/${editTarget.id}`, body)
			toast.success('Fulfillment updated')
			showEdit = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}
</script>

<svelte:head>
	<title>Fulfillments — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Fulfillments</h1>
			<p class="mt-1 text-body-sm text-secondary">{total} total</p>
		</div>
		{#if canWrite()}
			<Button onclick={openCreate}><Icon name="add" size="text-[16px]" /> New fulfillment</Button>
		{/if}
	</div>

	{#if !canRead()}
		<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
			You need the <span class="font-semibold text-on-surface">orders.read</span> permission to view this.
		</div>
	{:else}

	<div class="rounded border border-outline-variant bg-surface-container-lowest p-3">
		<div class="flex flex-wrap items-center gap-3">
			<select
				class="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary"
				bind:value={statusFilter}
				onchange={applyFilter}
			>
				{#each STATUS_OPTIONS as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>
	</div>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(5) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="inventory_2" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No fulfillments found.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Carrier</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Tracking</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
							<th class="px-table-cell-x py-table-cell-y text-right font-semibold">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each items as f (f.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<span class="font-medium text-primary">{f.orderNumber ? `#${f.orderNumber}` : f.id.slice(0, 8).toUpperCase()}</span>
								</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={f.status} /></td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{f.carrier ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y">
									{#if f.trackingUrl && f.trackingNumber}
										<a href={f.trackingUrl} target="_blank" rel="noopener" class="font-mono-label text-mono-label text-primary hover:underline">{f.trackingNumber}</a>
									{:else}
										<span class="text-on-surface-variant">{f.trackingNumber ?? '—'}</span>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary" title={dateTimeFull(f.createdAt)}>{timeAgo(f.createdAt)}</td>
								<td class="px-table-cell-x py-table-cell-y text-right">
									<div class="flex items-center justify-end gap-1">
										{#if canShipable(f.status)}
											<Button variant="ghost" size="sm" onclick={() => openShip(f)}><Icon name="local_shipping" size="text-[14px]" /> Ship</Button>
										{/if}
										{#if canCancel(f.status)}
											<Button variant="ghost" size="sm" onclick={() => cancelFulfillment(f)} class="hover:text-error"><Icon name="close" size="text-[14px]" /></Button>
										{/if}
										<Button variant="ghost" size="sm" onclick={() => openEdit(f)}><Icon name="edit" size="text-[14px]" /></Button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
	{/if}
</div>

{#if showCreate}
	<Modal title="New fulfillment" open={true} onClose={() => (showCreate = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); createFulfillment() }}>
			<div>
				<label class="field-label" for="fc-order">Order ID</label>
				<input id="fc-order" class="field" bind:value={createOrderId} placeholder="Raw order ID" required />
			</div>
			<div>
				<label class="field-label" for="fc-carrier">Carrier</label>
				<input id="fc-carrier" class="field" bind:value={createCarrier} placeholder="e.g. FedEx" />
			</div>
			<div>
				<label class="field-label" for="fc-courier">Courier provider</label>
				<input id="fc-courier" class="field" bind:value={createCourier} placeholder="e.g. FedEx Express" />
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" size="sm" onclick={() => (showCreate = false)}>Cancel</Button>
				<Button type="submit" size="sm" loading={saving}>Create</Button>
			</div>
		</form>
	</Modal>
{/if}

{#if showShip && shipTarget}
	<Modal title="Ship fulfillment" open={true} onClose={() => (showShip = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); submitShip() }}>
			<p class="text-sm text-on-surface-variant">
				Shipping fulfillment for order <span class="font-medium text-on-surface">{shipTarget.orderNumber ? `#${shipTarget.orderNumber}` : shipTarget.id.slice(0, 8).toUpperCase()}</span>.
			</p>
			<div>
				<label class="field-label" for="fs-tracking">Tracking number</label>
				<input id="fs-tracking" class="field" bind:value={shipTracking} placeholder="e.g. 1Z999AA10123456784" />
			</div>
			<div>
				<label class="field-label" for="fs-url">Tracking URL</label>
				<input id="fs-url" class="field" type="url" bind:value={shipTrackingUrl} placeholder="https://…" />
			</div>
			<div>
				<label class="field-label" for="fs-label">Label URL</label>
				<input id="fs-label" class="field" type="url" bind:value={shipLabelUrl} placeholder="https://…" />
			</div>
			<div>
				<label class="field-label" for="fs-carrier">Carrier</label>
				<input id="fs-carrier" class="field" bind:value={shipCarrier} placeholder="e.g. FedEx" />
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" size="sm" onclick={() => (showShip = false)}>Cancel</Button>
				<Button type="submit" size="sm" loading={saving}>Ship</Button>
			</div>
		</form>
	</Modal>
{/if}

{#if showEdit && editTarget}
	<Modal title="Edit fulfillment" open={true} onClose={() => (showEdit = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); submitEdit() }}>
			{#if TRANSITION_HINTS[editTarget.status]}
				<p class="rounded bg-surface-container px-3 py-2 text-xs text-secondary">{TRANSITION_HINTS[editTarget.status]}</p>
			{/if}
			<div>
				<label class="field-label" for="fe-carrier">Carrier</label>
				<input id="fe-carrier" class="field" bind:value={editCarrier} />
			</div>
			<div>
				<label class="field-label" for="fe-courier">Courier provider</label>
				<input id="fe-courier" class="field" bind:value={editCourier} />
			</div>
			<div>
				<label class="field-label" for="fe-tracking">Tracking number</label>
				<input id="fe-tracking" class="field" bind:value={editTracking} />
			</div>
			<div>
				<label class="field-label" for="fe-url">Tracking URL</label>
				<input id="fe-url" class="field" type="url" bind:value={editTrackingUrl} />
			</div>
			<div>
				<label class="field-label" for="fe-label">Label URL</label>
				<input id="fe-label" class="field" type="url" bind:value={editLabelUrl} />
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" size="sm" onclick={() => (showEdit = false)}>Cancel</Button>
				<Button type="submit" size="sm" loading={saving}>Save</Button>
			</div>
		</form>
	</Modal>
{/if}
