<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { dateTime } from '$lib/format'
	import type { DeliveryOrder, DeliveryStatus, DeliveryZone, Driver } from '$lib/types'

	const canAssign = $derived(session.can('delivery.assign'))
	const canManageZones = $derived(session.can('delivery.manage'))
	const canManageDrivers = $derived(session.can('drivers.manage'))

	const STATUS_TONE: Record<string, string> = {
		UNASSIGNED: 'bg-slate-100 text-slate-600 ring-slate-200',
		ASSIGNED: 'bg-sky-100 text-sky-800 ring-sky-200',
		ARRIVED_AT_PICKUP: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
		PICKED_UP: 'bg-amber-100 text-amber-800 ring-amber-200',
		IN_TRANSIT: 'bg-violet-100 text-violet-800 ring-violet-200',
		ARRIVED: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
		DELIVERED: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		FAILED: 'bg-rose-100 text-rose-800 ring-rose-200',
		CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200'
	}
	const DRIVER_TONE: Record<string, string> = {
		OFFLINE: 'bg-slate-100 text-slate-600 ring-slate-200',
		ONLINE: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		BUSY: 'bg-amber-100 text-amber-800 ring-amber-200',
		PAUSED: 'bg-sky-100 text-sky-800 ring-sky-200',
		SUSPENDED: 'bg-rose-100 text-rose-800 ring-rose-200'
	}

	let tab = $state<'deliveries' | 'drivers' | 'zones'>('deliveries')

	let deliveries = $state<DeliveryOrder[]>([])
	let drivers = $state<Driver[]>([])
	let zones = $state<DeliveryZone[]>([])
	let outlets = $state<{ id: string; name: string }[]>([])
	let loading = $state(true)

	let statusFilter = $state('')
	let selected = $state<DeliveryOrder | null>(null)

	// new delivery modal
	let showNew = $state(false)
	let newOrderId = $state('')
	let newZoneId = $state('')

	// zone mgmt modal
	let showZone = $state(false)
	let zoneName = $state('')
	let zoneOutlet = $state('')
	let zoneLat = $state('40.7128')
	let zoneLng = $state('-74.006')
	let zoneRadius = $state('10')
	let zoneFee = $state('5')
	let zoneMinOrder = $state('0')
	let zoneEta = $state('30')

	const deliveryStatuses: DeliveryStatus[] = [
		'UNASSIGNED', 'ASSIGNED', 'ARRIVED_AT_PICKUP', 'PICKED_UP',
		'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'FAILED', 'CANCELLED'
	]

	async function loadAll() {
		loading = true
		try {
			const [d, drvResp, z, o] = await Promise.all([
				api.get<{ success: boolean; data: DeliveryOrder[] }>('/api/deliveries', { status: statusFilter, limit: 200 }),
				api.get<{ success: boolean; data: { items: Driver[]; meta: unknown } }>('/api/drivers', { limit: 200 }),
				api.get<{ success: boolean; data: DeliveryZone[] }>('/api/delivery-zones'),
				api.get<{ success: boolean; data: { id: string; name: string }[] }>('/api/outlets')
			])
			deliveries = d.data
			drivers = drvResp.data.items
			zones = z.data
			outlets = o.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	const activeOrders = $derived((Array.isArray(deliveries) ? deliveries : []).filter((d) => !['DELIVERED', 'FAILED', 'CANCELLED'].includes(d.status)))
	const pastOrders = $derived((Array.isArray(deliveries) ? deliveries : []).filter((d) => ['DELIVERED', 'FAILED', 'CANCELLED'].includes(d.status)))

	async function dispatch(delivery: DeliveryOrder) {
		try {
			await api.post<{ success: boolean }>(`/api/deliveries/${delivery.id}/dispatch`)
			toast.success('Dispatch attempted')
			selected = null
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function assignTo(delivery: DeliveryOrder, driverId: string) {
		try {
			await api.post<{ success: boolean }>(`/api/deliveries/${delivery.id}/assign`, { driverId })
			toast.success('Assigned')
			selected = null
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function unassign(delivery: DeliveryOrder) {
		try {
			await api.post<{ success: boolean }>(`/api/deliveries/${delivery.id}/unassign`)
			toast.success('Unassigned')
			selected = null
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function transition(delivery: DeliveryOrder, status: DeliveryStatus) {
		try {
			await api.post<{ success: boolean }>(`/api/deliveries/${delivery.id}/status`, { status })
			toast.success(`Delivery → ${status}`)
			selected = null
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function createDelivery() {
		if (!newOrderId) return toast.error('Enter an order id')
		try {
			await api.post<{ success: boolean }>('/api/deliveries', {
				orderId: newOrderId,
				zoneId: newZoneId || undefined
			})
			toast.success('Delivery created')
			newOrderId = ''
			newZoneId = ''
			showNew = false
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function addZone() {
		if (!zoneName) return toast.error('Enter a zone name')
		try {
			await api.post<{ success: boolean }>('/api/delivery-zones', {
				name: zoneName,
				outletId: zoneOutlet || undefined,
				centerLat: Number(zoneLat) || 0,
				centerLng: Number(zoneLng) || 0,
				radiusKm: Number(zoneRadius) || 5,
				deliveryFee: Number(zoneFee) || 0,
				minOrder: Number(zoneMinOrder) || 0,
				etaMin: Number(zoneEta) || 30
			})
			toast.success('Zone added')
			zoneName = ''
			showZone = false
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function toggleDriver(driver: Driver) {
		if (driver.status === 'ONLINE') {
			await api.post<{ success: boolean }>(`/api/drivers/${driver.id}/status`, { status: 'OFFLINE' })
		} else if (driver.status === 'OFFLINE') {
			await api.post<{ success: boolean }>(`/api/drivers/${driver.id}/status`, { status: 'ONLINE' })
		} else {
			return toast.error('Cannot toggle from this state')
		}
		await loadAll()
	}

	async function removeZone(zone: DeliveryZone) {
		if (!confirm(`Remove zone "${zone.name}"?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/delivery-zones/${zone.id}`)
			toast.success('Zone removed')
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(loadAll)
</script>

<svelte:head><title>Delivery</title></svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold text-gray-900">Delivery</h1>
			<p class="text-sm text-gray-500">Zones, drivers and delivery order dispatch.</p>
		</div>
		{#if canAssign}
			<Button onclick={() => (showNew = true)}>New delivery</Button>
		{/if}
	</div>

	<div class="flex gap-2 border-b border-gray-200">
		{#each (['deliveries', 'drivers', 'zones'] as const) as t (t)}
			<button
				type="button"
				class="border-b-2 px-3 py-2 text-sm font-medium {tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}"
				onclick={() => (tab = t)}
			>
				{t === 'deliveries' ? 'Deliveries' : t === 'drivers' ? 'Drivers' : 'Zones'}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="py-10 text-center text-sm text-gray-500">Loading delivery…</div>
	{:else if tab === 'deliveries'}
		<Card>
			<div class="mb-3 flex flex-wrap items-center gap-2">
				<h2 class="text-sm font-semibold text-gray-900">Active deliveries</h2>
				<select bind:value={statusFilter} onchange={loadAll} class="ml-auto rounded-lg border border-gray-300 px-2 py-1 text-sm">
					<option value="">All statuses</option>
					{#each deliveryStatuses as s (s)}<option value={s}>{s}</option>{/each}
				</select>
			</div>
			{#if activeOrders.length === 0}
				<p class="py-6 text-center text-sm text-gray-500">No active deliveries.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="text-xs text-gray-500">
							<tr>
								<th class="pb-2 font-medium">Order</th>
								<th class="pb-2 font-medium">Outlet</th>
								<th class="pb-2 font-medium">Driver</th>
								<th class="pb-2 font-medium">Status</th>
								<th class="pb-2 font-medium">Fee</th>
								<th class="pb-2 font-medium">Created</th>
							</tr>
						</thead>
						<tbody>
							{#each activeOrders as d (d.id)}
								<tr class="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onclick={() => (selected = d)}>
									<td class="py-2 font-medium text-gray-900">#{d.orderNumber}</td>
									<td class="py-2 text-gray-600">{d.outletName ?? '—'}</td>
									<td class="py-2 text-gray-600">{d.driverName ?? '—'}</td>
									<td class="py-2"><span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[d.status]}">{d.status}</span></td>
									<td class="py-2 text-gray-600">${(d.fee ?? 0).toFixed(2)}</td>
									<td class="py-2 text-gray-600">{dateTime(d.createdAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>

		<Card>
			<h2 class="mb-3 text-sm font-semibold text-gray-900">Past deliveries</h2>
			{#if pastOrders.length === 0}
				<p class="py-6 text-center text-sm text-gray-500">No completed deliveries.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="text-xs text-gray-500">
							<tr>
								<th class="pb-2 font-medium">Order</th>
								<th class="pb-2 font-medium">Driver</th>
								<th class="pb-2 font-medium">Status</th>
								<th class="pb-2 font-medium">Delivered</th>
							</tr>
						</thead>
						<tbody>
							{#each pastOrders as d (d.id)}
								<tr class="border-t border-gray-100">
									<td class="py-2 font-medium text-gray-900">#{d.orderNumber}</td>
									<td class="py-2 text-gray-600">{d.driverName ?? '—'}</td>
									<td class="py-2"><span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[d.status]}">{d.status}</span></td>
									<td class="py-2 text-gray-600">{d.deliveredAt ? dateTime(d.deliveredAt) : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	{:else if tab === 'drivers'}
		<Card>
			<h2 class="mb-3 text-sm font-semibold text-gray-900">Drivers</h2>
			{#if drivers.length === 0}
				<p class="py-6 text-center text-sm text-gray-500">No drivers yet.</p>
			{:else}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each drivers as drv (drv.id)}
						<Card>
							<div class="flex items-center justify-between">
								<h3 class="font-semibold text-gray-900">{drv.name}</h3>
								<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {DRIVER_TONE[drv.status]}">{drv.status}</span>
							</div>
							<div class="mt-2 space-y-1 text-xs text-gray-500">
								<p>{drv.vehicleType ?? '—'} · {drv.vehiclePlate ?? '—'}</p>
								<p>Outlet: {drv.outletName ?? '—'}</p>
							</div>
							{#if canManageDrivers && (drv.status === 'ONLINE' || drv.status === 'OFFLINE')}
								<div class="mt-3">
									<Button size="sm" variant="secondary" onclick={() => toggleDriver(drv)}>
										{drv.status === 'ONLINE' ? 'Go offline' : 'Bring online'}
									</Button>
								</div>
							{/if}
						</Card>
					{/each}
				</div>
			{/if}
		</Card>
	{:else if tab === 'zones'}
		<Card>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-sm font-semibold text-gray-900">Delivery zones</h2>
				{#if canManageZones}
					<Button size="sm" onclick={() => (showZone = true)}>Add zone</Button>
				{/if}
			</div>
			{#if zones.length === 0}
				<p class="py-6 text-center text-sm text-gray-500">No zones yet.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="text-xs text-gray-500">
							<tr>
								<th class="pb-2 font-medium">Name</th>
								<th class="pb-2 font-medium">Radius</th>
								<th class="pb-2 font-medium">Fee</th>
								<th class="pb-2 font-medium">Min order</th>
								<th class="pb-2 font-medium">ETA</th>
								<th class="pb-2 font-medium"></th>
							</tr>
						</thead>
						<tbody>
							{#each zones as z (z.id)}
								<tr class="border-t border-gray-100">
									<td class="py-2 font-medium text-gray-900">{z.name}</td>
									<td class="py-2 text-gray-600">{z.radiusKm} km</td>
									<td class="py-2 text-gray-600">${(z.deliveryFee ?? 0).toFixed(2)}</td>
									<td class="py-2 text-gray-600">${(z.minOrder ?? 0).toFixed(2)}</td>
									<td class="py-2 text-gray-600">{z.etaMin} min</td>
									<td class="py-2 text-right">
										{#if canManageZones}
											<button type="button" class="text-xs text-rose-600 hover:underline" onclick={() => removeZone(z)}>Remove</button>
										{/if}
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

{#if selected && canAssign}
	<Modal title={`Delivery #${selected.orderNumber}`} onClose={() => (selected = null)}>
		<div class="space-y-4">
			<div class="flex flex-wrap items-center gap-2">
				<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[selected.status]}">{selected.status}</span>
				<span class="text-sm text-gray-500">Outlet {selected.outletName ?? '—'} · ETA {selected.etaMin} min</span>
			</div>

			<div>
				<span class="mb-1 block text-xs text-gray-500">Address</span>
				<p class="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
					{selected.address?.line1 ?? ''} {selected.address?.city ?? ''} {selected.address?.postalCode ?? ''}
				</p>
			</div>

			{#if selected.status === 'UNASSIGNED'}
				<div class="flex gap-2">
					<Button onclick={() => dispatch(selected!)}>Auto-dispatch</Button>
				</div>
				<div>
					<span class="mb-1 block text-xs text-gray-500">Assign driver</span>
					<div class="grid gap-1">
						{#each drivers.filter((d) => d.status === 'ONLINE') as drv (drv.id)}
							<button
								type="button"
								class="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50"
								onclick={() => assignTo(selected!, drv.id)}
							>
								{drv.name} · {drv.vehicleType ?? '—'}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if ['ASSIGNED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED'].includes(selected.status)}
				<div class="flex flex-wrap gap-2">
					{#if selected.status === 'ASSIGNED'}
						<Button onclick={() => transition(selected!, 'ARRIVED_AT_PICKUP')}>Arrived at pickup</Button>
					{/if}
					{#if selected.status === 'ARRIVED_AT_PICKUP'}
						<Button onclick={() => transition(selected!, 'PICKED_UP')}>Picked up</Button>
					{/if}
					{#if selected.status === 'PICKED_UP'}
						<Button onclick={() => transition(selected!, 'IN_TRANSIT')}>In transit</Button>
					{/if}
					{#if selected.status === 'IN_TRANSIT'}
						<Button onclick={() => transition(selected!, 'ARRIVED')}>Arrived</Button>
					{/if}
					{#if selected.status === 'ARRIVED'}
						<Button onclick={() => transition(selected!, 'DELIVERED')}>Mark delivered</Button>
					{/if}
					<Button variant="secondary" onclick={() => unassign(selected!)}>Unassign</Button>
				</div>
			{/if}
		</div>
	</Modal>
{/if}

{#if showNew && canAssign}
	<Modal title="New delivery" onClose={() => (showNew = false)}>
		<div class="space-y-4">
			<div>
				<label for="dl-order" class="mb-1 block text-sm text-gray-600">Order id</label>
				<input id="dl-order" bind:value={newOrderId} placeholder="Order id" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
			</div>
			<div>
				<label for="dl-zone" class="mb-1 block text-sm text-gray-600">Zone (optional)</label>
				<select id="dl-zone" bind:value={newZoneId} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
					<option value="">No zone</option>
					{#each zones as z (z.id)}<option value={z.id}>{z.name}</option>{/each}
				</select>
			</div>
			<Button onclick={createDelivery}>Create delivery</Button>
		</div>
	</Modal>
{/if}

{#if showZone && canManageZones}
	<Modal title="Add delivery zone" onClose={() => (showZone = false)}>
		<div class="space-y-4">
			<div>
				<label for="zn-name" class="mb-1 block text-sm text-gray-600">Zone name</label>
				<input id="zn-name" bind:value={zoneName} placeholder="e.g. Downtown" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
			</div>
			<div>
				<label for="zn-outlet" class="mb-1 block text-sm text-gray-600">Outlet</label>
				<select id="zn-outlet" bind:value={zoneOutlet} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
					<option value="">Any</option>
					{#each outlets as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
				</select>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div>
					<label for="zn-lat" class="mb-1 block text-sm text-gray-600">Latitude</label>
					<input id="zn-lat" bind:value={zoneLat} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
				<div>
					<label for="zn-lng" class="mb-1 block text-sm text-gray-600">Longitude</label>
					<input id="zn-lng" bind:value={zoneLng} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
			</div>
			<div class="grid grid-cols-3 gap-2">
				<div>
					<label for="zn-radius" class="mb-1 block text-sm text-gray-600">Radius km</label>
					<input id="zn-radius" bind:value={zoneRadius} type="number" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
				<div>
					<label for="zn-fee" class="mb-1 block text-sm text-gray-600">Fee</label>
					<input id="zn-fee" bind:value={zoneFee} type="number" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
				<div>
					<label for="zn-min" class="mb-1 block text-sm text-gray-600">Min order</label>
					<input id="zn-min" bind:value={zoneMinOrder} type="number" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
			</div>
			<div>
				<label for="zn-eta" class="mb-1 block text-sm text-gray-600">ETA (min)</label>
				<input id="zn-eta" bind:value={zoneEta} type="number" min="1" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
			</div>
			<Button onclick={addZone}>Add zone</Button>
		</div>
	</Modal>
{/if}
