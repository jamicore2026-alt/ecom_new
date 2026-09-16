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
	import type { DeliveryOrder, DeliveryStatus, DeliveryZone, Driver } from '$lib/types'

	const canAssign = $derived(session.can('delivery.assign'))
	const canManageZones = $derived(session.can('delivery.manage'))
	const canManageDrivers = $derived(session.can('drivers.manage'))

	const STATUS_TONE: Record<string, string> = {
		UNASSIGNED: 'bg-secondary/10 text-secondary ring-secondary',
		ASSIGNED: 'bg-info/10 text-info ring-info',
		ARRIVED_AT_PICKUP: 'bg-primary/10 text-primary ring-primary',
		PICKED_UP: 'bg-warning/10 text-warning ring-warning',
		IN_TRANSIT: 'bg-tertiary/10 text-tertiary ring-tertiary',
		ARRIVED: 'bg-info/10 text-info ring-info',
		DELIVERED: 'bg-success/10 text-success ring-success',
		FAILED: 'bg-error/10 text-error ring-error',
		CANCELLED: 'bg-secondary/10 text-secondary ring-secondary'
	}
	const DRIVER_TONE: Record<string, string> = {
		OFFLINE: 'bg-secondary/10 text-secondary ring-secondary',
		ONLINE: 'bg-success/10 text-success ring-success',
		BUSY: 'bg-warning/10 text-warning ring-warning',
		PAUSED: 'bg-info/10 text-info ring-info',
		SUSPENDED: 'bg-error/10 text-error ring-error'
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

	// zone mgmt modal (create + edit)
	let showZone = $state(false)
	let editingZone = $state<string | null>(null)
	let zoneName = $state('')
	let zoneOutlet = $state('')
	let zoneLat = $state('40.7128')
	let zoneLng = $state('-74.006')
	let zoneRadius = $state('10')
	let zoneFee = $state('5')
	let zoneMinOrder = $state('0')
	let zoneFreeThreshold = $state('')
	let zoneEta = $state('30')
	let zoneStatus = $state<'active' | 'inactive'>('active')

	// driver mgmt modal (create + edit)
	let showDriver = $state(false)
	let editingDriver = $state<string | null>(null)
	let driverForm = $state({
		userId: '',
		name: '',
		phone: '',
		email: '',
		vehicleType: '',
		vehiclePlate: '',
		assignedOutletId: ''
	})

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

	function openAddZone() {
		editingZone = null
		zoneName = ''
		zoneOutlet = ''
		zoneLat = '40.7128'
		zoneLng = '-74.006'
		zoneRadius = '10'
		zoneFee = '5'
		zoneMinOrder = '0'
		zoneFreeThreshold = ''
		zoneEta = '30'
		zoneStatus = 'active'
		showZone = true
	}

	function openEditZone(zone: DeliveryZone) {
		editingZone = zone.id
		zoneName = zone.name
		zoneOutlet = zone.outletId ?? ''
		zoneLat = String(zone.centerLat)
		zoneLng = String(zone.centerLng)
		zoneRadius = String(zone.radiusKm)
		zoneFee = String(zone.deliveryFee)
		zoneMinOrder = String(zone.minOrder)
		zoneFreeThreshold = zone.freeDeliveryThreshold != null ? String(zone.freeDeliveryThreshold) : ''
		zoneEta = String(zone.etaMin)
		zoneStatus = zone.status
		showZone = true
	}

	async function saveZone() {
		if (!zoneName) return toast.error('Enter a zone name')
		const freeThreshold = zoneFreeThreshold === '' ? undefined : Number(zoneFreeThreshold)
		const payload = {
			name: zoneName,
			outletId: zoneOutlet || undefined,
			centerLat: Number(zoneLat) || 0,
			centerLng: Number(zoneLng) || 0,
			radiusKm: Number(zoneRadius) || 5,
			deliveryFee: Number(zoneFee) || 0,
			minOrder: Number(zoneMinOrder) || 0,
			freeDeliveryThreshold: freeThreshold,
			etaMin: Number(zoneEta) || 30,
			status: zoneStatus
		}
		try {
			if (editingZone) {
				await api.put<{ success: boolean }>(`/api/delivery-zones/${editingZone}`, payload)
				toast.success('Zone updated')
			} else {
				await api.post<{ success: boolean }>('/api/delivery-zones', payload)
				toast.success('Zone added')
			}
			showZone = false
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function openCreateDriver() {
		editingDriver = null
		driverForm = { userId: '', name: '', phone: '', email: '', vehicleType: '', vehiclePlate: '', assignedOutletId: '' }
		showDriver = true
	}

	function openEditDriver(drv: Driver) {
		editingDriver = drv.id
		driverForm = {
			userId: drv.userId,
			name: drv.name,
			phone: drv.phone ?? '',
			email: drv.email ?? '',
			vehicleType: drv.vehicleType ?? '',
			vehiclePlate: drv.vehiclePlate ?? '',
			assignedOutletId: drv.assignedOutletId ?? ''
		}
		showDriver = true
	}

	async function saveDriver() {
		if (!driverForm.name) return toast.error('Enter a driver name')
		const payload = {
			name: driverForm.name,
			phone: driverForm.phone || undefined,
			email: driverForm.email || undefined,
			vehicleType: driverForm.vehicleType || undefined,
			vehiclePlate: driverForm.vehiclePlate || undefined,
			assignedOutletId: driverForm.assignedOutletId || undefined
		}
		try {
			if (editingDriver) {
				await api.put<{ success: boolean }>(`/api/drivers/${editingDriver}`, payload)
				toast.success('Driver updated')
			} else {
				await api.post<{ success: boolean }>('/api/drivers', { ...payload, userId: driverForm.userId })
				toast.success('Driver added')
			}
			showDriver = false
			await loadAll()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function removeDriver(driver: Driver) {
		if (!confirm(`Remove driver "${driver.name}"?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/drivers/${driver.id}`)
			toast.success('Driver removed')
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

<svelte:head><title>Delivery — JamiCore</title></svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Delivery</h1>
			<p class="mt-1 text-body-sm text-secondary">Zones, drivers and delivery order dispatch.</p>
		</div>
		{#if canAssign}
			<Button onclick={() => (showNew = true)}><Icon name="local_shipping" size="text-[18px]" /> New delivery</Button>
		{/if}
	</div>

	<div class="flex gap-2 border-b border-outline-variant">
		{#each (['deliveries', 'drivers', 'zones'] as const) as t (t)}
			<button
				type="button"
				class="border-b-2 px-3 py-2 text-sm font-medium {tab === t ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-on-surface'}"
				onclick={() => (tab = t)}
			>
				{t === 'deliveries' ? 'Deliveries' : t === 'drivers' ? 'Drivers' : 'Zones'}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="py-10 text-center text-sm text-secondary">Loading delivery…</div>
	{:else if tab === 'deliveries'}
		<Card>
			<div class="mb-3 flex flex-wrap items-center gap-2">
				<h2 class="text-sm font-semibold text-on-surface">Active deliveries</h2>
				<select bind:value={statusFilter} onchange={loadAll} class="field ml-auto w-auto">
					<option value="">All statuses</option>
					{#each deliveryStatuses as s (s)}<option value={s}>{s}</option>{/each}
				</select>
			</div>
			{#if activeOrders.length === 0}
				<p class="py-6 text-center text-sm text-secondary">No active deliveries.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="font-table-header text-table-header uppercase tracking-wider text-secondary">
							<tr>
								<th class="pb-2 font-semibold">Order</th>
								<th class="pb-2 font-semibold">Outlet</th>
								<th class="pb-2 font-semibold">Driver</th>
								<th class="pb-2 font-semibold">Status</th>
								<th class="pb-2 font-semibold">Fee</th>
								<th class="pb-2 font-semibold">Created</th>
							</tr>
						</thead>
						<tbody>
							{#each activeOrders as d (d.id)}
								<tr class="cursor-pointer border-t border-outline-variant transition-colors hover:bg-surface-container-low" onclick={() => (selected = d)}>
									<td class="py-2 font-mono-label text-mono-label font-medium text-on-surface">#{d.orderNumber}</td>
									<td class="py-2 text-on-surface-variant">{d.outletName ?? '—'}</td>
									<td class="py-2 text-on-surface-variant">{d.driverName ?? '—'}</td>
									<td class="py-2"><span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[d.status]}">{d.status}</span></td>
									<td class="py-2 font-mono-label text-mono-label text-on-surface">${(d.fee ?? 0).toFixed(2)}</td>
									<td class="py-2 text-secondary">{dateTime(d.createdAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>

		<Card>
			<h2 class="mb-3 text-sm font-semibold text-on-surface">Past deliveries</h2>
			{#if pastOrders.length === 0}
				<p class="py-6 text-center text-sm text-secondary">No completed deliveries.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="font-table-header text-table-header uppercase tracking-wider text-secondary">
							<tr>
								<th class="pb-2 font-semibold">Order</th>
								<th class="pb-2 font-semibold">Driver</th>
								<th class="pb-2 font-semibold">Status</th>
								<th class="pb-2 font-semibold">Delivered</th>
							</tr>
						</thead>
						<tbody>
							{#each pastOrders as d (d.id)}
								<tr class="border-t border-outline-variant">
									<td class="py-2 font-mono-label text-mono-label font-medium text-on-surface">#{d.orderNumber}</td>
									<td class="py-2 text-on-surface-variant">{d.driverName ?? '—'}</td>
									<td class="py-2"><span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[d.status]}">{d.status}</span></td>
									<td class="py-2 text-secondary">{d.deliveredAt ? dateTime(d.deliveredAt) : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	{:else if tab === 'drivers'}
		<Card>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-sm font-semibold text-on-surface">Drivers</h2>
				{#if canManageDrivers}
					<Button size="sm" onclick={openCreateDriver}>Add driver</Button>
				{/if}
			</div>
			{#if drivers.length === 0}
				<p class="py-6 text-center text-sm text-secondary">No drivers yet.</p>
			{:else}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each drivers as drv (drv.id)}
						<Card>
							<div class="flex items-center justify-between">
								<h3 class="font-semibold text-on-surface">{drv.name}</h3>
								<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {DRIVER_TONE[drv.status]}">{drv.status}</span>
							</div>
							<div class="mt-2 space-y-1 text-xs text-secondary">
								<p>{drv.vehicleType ?? '—'} · {drv.vehiclePlate ?? '—'}</p>
								<p>Outlet: {drv.outletName ?? '—'}</p>
							</div>
							{#if canManageDrivers}
								<div class="mt-3 flex flex-wrap gap-2">
									{#if drv.status === 'ONLINE' || drv.status === 'OFFLINE'}
										<Button size="sm" variant="secondary" onclick={() => toggleDriver(drv)}>
											{drv.status === 'ONLINE' ? 'Go offline' : 'Bring online'}
										</Button>
									{/if}
									<Button size="sm" variant="secondary" onclick={() => openEditDriver(drv)}>Edit</Button>
									<Button size="sm" variant="danger" onclick={() => removeDriver(drv)}>Remove</Button>
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
				<h2 class="text-sm font-semibold text-on-surface">Delivery zones</h2>
				{#if canManageZones}
					<Button size="sm" onclick={openAddZone}>Add zone</Button>
				{/if}
			</div>
			{#if zones.length === 0}
				<p class="py-6 text-center text-sm text-secondary">No zones yet.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="font-table-header text-table-header uppercase tracking-wider text-secondary">
							<tr>
								<th class="pb-2 font-semibold">Name</th>
								<th class="pb-2 font-semibold">Radius</th>
								<th class="pb-2 font-semibold">Fee</th>
								<th class="pb-2 font-semibold">Min order</th>
								<th class="pb-2 font-semibold">ETA</th>
								<th class="pb-2 font-semibold"></th>
							</tr>
						</thead>
						<tbody>
							{#each zones as z (z.id)}
								<tr class="border-t border-outline-variant">
									<td class="py-2 font-medium text-on-surface">{z.name}</td>
									<td class="py-2 text-on-surface-variant">{z.radiusKm} km</td>
									<td class="py-2 font-mono-label text-mono-label text-on-surface">${(z.deliveryFee ?? 0).toFixed(2)}</td>
									<td class="py-2 font-mono-label text-mono-label text-on-surface">${(z.minOrder ?? 0).toFixed(2)}</td>
									<td class="py-2 text-on-surface-variant">{z.etaMin} min</td>
<td class="py-2 text-right">
									{#if canManageZones}
										<div class="flex justify-end gap-1">
											<button type="button" class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEditZone(z)}>Edit</button>
											<button type="button" class="rounded p-1.5 text-xs text-error hover:bg-error-container/40" onclick={() => removeZone(z)}>Remove</button>
										</div>
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
	<Modal open={true} title={`Delivery #${selected.orderNumber}`} onClose={() => (selected = null)}>
		<div class="space-y-4">
			<div class="flex flex-wrap items-center gap-2">
				<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[selected.status]}">{selected.status}</span>
				<span class="text-sm text-secondary">Outlet {selected.outletName ?? '—'} · ETA {selected.etaMin} min</span>
			</div>

			<div>
				<span class="mb-1 block text-xs text-secondary">Address</span>
				<p class="rounded border border-outline-variant bg-surface-container-low p-3 text-sm text-on-surface-variant">
					{selected.address?.line1 ?? ''} {selected.address?.city ?? ''} {selected.address?.postalCode ?? ''}
				</p>
			</div>

			{#if selected.status === 'UNASSIGNED'}
				<div class="flex gap-2">
					<Button onclick={() => dispatch(selected!)}>Auto-dispatch</Button>
				</div>
				<div>
					<span class="mb-1 block text-xs text-secondary">Assign driver</span>
					<div class="grid gap-1">
						{#each drivers.filter((d) => d.status === 'ONLINE') as drv (drv.id)}
							<button
								type="button"
								class="rounded border border-outline-variant px-3 py-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-container-low"
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
	<Modal open={true} title="New delivery" onClose={() => (showNew = false)}>
		<div class="space-y-4">
			<div>
				<label for="dl-order" class="field-label">Order id</label>
				<input id="dl-order" class="field" bind:value={newOrderId} placeholder="Order id" />
			</div>
			<div>
				<label for="dl-zone" class="field-label">Zone (optional)</label>
				<select id="dl-zone" class="field" bind:value={newZoneId}>
					<option value="">No zone</option>
					{#each zones as z (z.id)}<option value={z.id}>{z.name}</option>{/each}
				</select>
			</div>
			<Button onclick={createDelivery}>Create delivery</Button>
		</div>
	</Modal>
{/if}

{#if showZone && canManageZones}
	<Modal open={true} title={editingZone ? 'Edit delivery zone' : 'Add delivery zone'} onClose={() => (showZone = false)}>
		<div class="space-y-4">
			<div>
				<label for="zn-name" class="field-label">Zone name</label>
				<input id="zn-name" class="field" bind:value={zoneName} placeholder="e.g. Downtown" />
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div>
					<label for="zn-outlet" class="field-label">Outlet</label>
					<select id="zn-outlet" class="field" bind:value={zoneOutlet}>
						<option value="">Any</option>
						{#each outlets as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
					</select>
				</div>
				<div>
					<label for="zn-status" class="field-label">Status</label>
					<select id="zn-status" class="field" bind:value={zoneStatus}>
						<option value="active">Active</option>
						<option value="inactive">Inactive</option>
					</select>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div>
					<label for="zn-lat" class="field-label">Latitude</label>
					<input id="zn-lat" class="field" bind:value={zoneLat} />
				</div>
				<div>
					<label for="zn-lng" class="field-label">Longitude</label>
					<input id="zn-lng" class="field" bind:value={zoneLng} />
				</div>
			</div>
			<div class="grid grid-cols-3 gap-2">
				<div>
					<label for="zn-radius" class="field-label">Radius km</label>
					<input id="zn-radius" class="field" bind:value={zoneRadius} type="number" min="0" />
				</div>
				<div>
					<label for="zn-fee" class="field-label">Fee</label>
					<input id="zn-fee" class="field" bind:value={zoneFee} type="number" min="0" />
				</div>
				<div>
					<label for="zn-min" class="field-label">Min order</label>
					<input id="zn-min" class="field" bind:value={zoneMinOrder} type="number" min="0" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div>
					<label for="zn-free" class="field-label">Free delivery over</label>
					<input id="zn-free" class="field" bind:value={zoneFreeThreshold} type="number" min="0" placeholder="Leave empty for none" />
				</div>
				<div>
					<label for="zn-eta" class="field-label">ETA (min)</label>
					<input id="zn-eta" class="field" bind:value={zoneEta} type="number" min="1" />
				</div>
			</div>
			<Button onclick={saveZone}>{editingZone ? 'Save changes' : 'Add zone'}</Button>
		</div>
	</Modal>
{/if}

{#if showDriver && canManageDrivers}
	<Modal open={true} title={editingDriver ? 'Edit driver' : 'Add driver'} onClose={() => (showDriver = false)}>
		<div class="space-y-4">
			{#if !editingDriver}
				<div>
					<label for="dr-user" class="field-label">User id</label>
					<input id="dr-user" class="field" bind:value={driverForm.userId} placeholder="User id" />
				</div>
			{/if}
			<div>
				<label for="dr-name" class="field-label">Name</label>
				<input id="dr-name" class="field" bind:value={driverForm.name} placeholder="e.g. Alex Rivera" />
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div>
					<label for="dr-phone" class="field-label">Phone</label>
					<input id="dr-phone" class="field" bind:value={driverForm.phone} />
				</div>
				<div>
					<label for="dr-email" class="field-label">Email</label>
					<input id="dr-email" class="field" bind:value={driverForm.email} />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div>
					<label for="dr-vtype" class="field-label">Vehicle type</label>
					<input id="dr-vtype" class="field" bind:value={driverForm.vehicleType} placeholder="e.g. Bike" />
				</div>
				<div>
					<label for="dr-vplate" class="field-label">Vehicle plate</label>
					<input id="dr-vplate" class="field" bind:value={driverForm.vehiclePlate} />
				</div>
			</div>
			<div>
				<label for="dr-outlet" class="field-label">Outlet</label>
				<select id="dr-outlet" class="field" bind:value={driverForm.assignedOutletId}>
					<option value="">Any</option>
					{#each outlets as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
				</select>
			</div>
			<Button onclick={saveDriver}>{editingDriver ? 'Save changes' : 'Add driver'}</Button>
		</div>
	</Modal>
{/if}
