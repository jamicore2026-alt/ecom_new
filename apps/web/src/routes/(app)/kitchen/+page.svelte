<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { dateTime } from '$lib/format'
	import type { KitchenStation, KitchenTicket, KotStatus } from '$lib/types'

	const canManage = $derived(session.can('kitchen.manage'))

	const STATUS_TONE: Record<string, string> = {
		NEW: 'bg-amber-100 text-amber-800 ring-amber-200',
		ACCEPTED: 'bg-sky-100 text-sky-800 ring-sky-200',
		PREPARING: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
		READY: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		RECALLED: 'bg-rose-100 text-rose-800 ring-rose-200',
		CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200'
	}
	const PRIORITY_TONE: Record<string, string> = {
		LOW: 'bg-slate-100 text-slate-600 ring-slate-200',
		NORMAL: 'bg-slate-100 text-slate-700 ring-slate-300',
		HIGH: 'bg-rose-100 text-rose-800 ring-rose-300'
	}

	let stations = $state<KitchenStation[]>([])
	let tickets = $state<KitchenTicket[]>([])
	let loading = $state(true)

	let statusFilter = $state('')
	let stationFilter = $state('')
	let selected = $state<KitchenTicket | null>(null)

	// station management
	let showManage = $state(false)
	let outlets = $state<{ id: string; name: string }[]>([])
	let newStationName = $state('')
	let newStationOutlet = $state('')
	let newStationSla = $state('12')
	let newStationSort = $state('0')

	const statuses: KotStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'RECALLED', 'CANCELLED']

	async function load() {
		loading = true
		try {
			const [s, t] = await Promise.all([
				api.get<{ success: boolean; data: KitchenStation[] }>('/api/kitchen-stations'),
				api.get<{ success: boolean; data: KitchenTicket[] }>('/api/kitchen/tickets', {
					status: statusFilter,
					stationId: stationFilter,
					limit: 200
				})
			])
			stations = s.data
			tickets = t.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	const filteredTickets = $derived(tickets)

	async function openManage() {
		showManage = true
		try {
			const o = await api.get<{ success: boolean; data: { id: string; name: string }[] }>('/api/outlets')
			outlets = o.data
			newStationOutlet = o.data[0]?.id || ''
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function addStation() {
		if (!newStationName) return toast.error('Enter a station name')
		try {
			await api.post<{ success: boolean }>('/api/kitchen-stations', {
				name: newStationName,
				outletId: newStationOutlet,
				prepSlaMin: Number(newStationSla) || 10,
				sortOrder: Number(newStationSort) || 0
			})
			toast.success('Station added')
			newStationName = ''
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function toggleStation(station: KitchenStation) {
		try {
			await api.put<{ success: boolean }>(`/api/kitchen-stations/${station.id}`, { status: station.status === 'active' ? 'inactive' : 'active' })
			toast.success(`${station.name} ${station.status === 'active' ? 'paused' : 'activated'}`)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function removeStation(station: KitchenStation) {
		if (!confirm(`Remove station "${station.name}"?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/kitchen-stations/${station.id}`)
			toast.success('Station removed')
			if (stationFilter === station.id) stationFilter = ''
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function transition(status: KotStatus) {
		if (!selected) return
		try {
			await api.post<{ success: boolean }>(`/api/kitchen/tickets/${selected.id}/status`, { status })
			toast.success(`Ticket → ${status}`)
			selected = null
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function setPriority(p: 'LOW' | 'NORMAL' | 'HIGH') {
		if (!selected) return
		try {
			await api.put<{ success: boolean }>(`/api/kitchen/tickets/${selected.id}/priority`, { priority: p })
			toast.success(`Priority → ${p}`)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(load)
</script>

<svelte:head><title>Kitchen</title></svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold text-gray-900">Kitchen</h1>
			<p class="text-sm text-gray-500">Stations, prep SLAs and kitchen tickets (KOT).</p>
		</div>
		{#if canManage}
			<Button onclick={openManage}>Manage stations</Button>
		{/if}
	</div>

	{#if loading}
		<div class="py-10 text-center text-sm text-gray-500">Loading kitchen…</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each stations as station (station.id)}
				<Card>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="h-2.5 w-2.5 rounded-full {station.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}" aria-hidden="true"></span>
							<h3 class="font-semibold text-gray-900">{station.name}</h3>
						</div>
						{#if canManage}
							<div class="flex gap-1">
								<button type="button" class="text-xs text-indigo-600 hover:underline" onclick={() => toggleStation(station)}>
									{station.status === 'active' ? 'Pause' : 'Activate'}
								</button>
								<button type="button" class="text-xs text-rose-600 hover:underline" onclick={() => removeStation(station)}>Remove</button>
							</div>
						{/if}
					</div>
					<div class="mt-2 text-xs text-gray-500">
						<span>SLA {station.prepSlaMin} min</span>
						<span class="mx-1">·</span>
						<span>{station.openTickets} open ticket(s)</span>
					</div>
				</Card>
			{:else}
				<Card>
					<div class="py-6 text-center text-sm text-gray-500">No stations yet.</div>
				</Card>
			{/each}
		</div>

		<Card>
			<div class="mb-3 flex flex-wrap items-center gap-2">
				<h2 class="text-sm font-semibold text-gray-900">Kitchen tickets</h2>
				<select bind:value={statusFilter} onchange={load} class="rounded-lg border border-gray-300 px-2 py-1 text-sm">
					<option value="">All statuses</option>
					{#each statuses as s (s)}<option value={s}>{s}</option>{/each}
				</select>
				<select bind:value={stationFilter} onchange={load} class="rounded-lg border border-gray-300 px-2 py-1 text-sm">
					<option value="">All stations</option>
					{#each stations as st (st.id)}<option value={st.id}>{st.name}</option>{/each}
				</select>
			</div>
			{#if filteredTickets.length === 0}
				<p class="py-6 text-center text-sm text-gray-500">No tickets.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="text-xs text-gray-500">
							<tr>
								<th class="pb-2 font-medium">Order</th>
								<th class="pb-2 font-medium">Station</th>
								<th class="pb-2 font-medium">Status</th>
								<th class="pb-2 font-medium">Priority</th>
								<th class="pb-2 font-medium">Age</th>
								<th class="pb-2 font-medium">Received</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredTickets as t (t.id)}
								<tr class="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onclick={() => (selected = t)}>
									<td class="py-2 font-medium text-gray-900">#{t.orderNumber}</td>
									<td class="py-2 text-gray-600">{t.stationName}</td>
									<td class="py-2"><span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[t.status]}">{t.status}</span></td>
									<td class="py-2"><span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {PRIORITY_TONE[t.priority]}">{t.priority}</span></td>
									<td class="py-2 text-gray-600">{Math.floor(t.ageSec / 60)}m</td>
									<td class="py-2 text-gray-600">{dateTime(t.receivedAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	{/if}
</div>

{#if selected && canManage}
	<Modal title={`Ticket #${selected.orderNumber} — ${selected.stationName}`} onClose={() => (selected = null)}>
		<div class="space-y-4">
			<div class="flex flex-wrap items-center gap-2">
				<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[selected.status]}">{selected.status}</span>
				<span class="text-sm text-gray-500">
					{selected.orderType} · received {dateTime(selected.receivedAt)} · {Math.floor(selected.ageSec / 60)}m old
				</span>
				{#if selected.delayed}
					<span class="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-800 ring-1 ring-inset ring-rose-200">Delayed</span>
				{/if}
			</div>

			<div>
				<span class="mb-1 block text-xs text-gray-500">Priority</span>
				<div class="flex gap-2">
					<Button size="sm" variant={selected.priority === 'HIGH' ? 'primary' : 'secondary'} onclick={() => setPriority('HIGH')}>High</Button>
					<Button size="sm" variant={selected.priority === 'NORMAL' ? 'primary' : 'secondary'} onclick={() => setPriority('NORMAL')}>Normal</Button>
					<Button size="sm" variant={selected.priority === 'LOW' ? 'primary' : 'secondary'} onclick={() => setPriority('LOW')}>Low</Button>
				</div>
			</div>

			<div>
				<span class="mb-1 block text-xs text-gray-500">Items</span>
				<ul class="space-y-1 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
					{#each selected.items as item (item.name)}
						<li class="flex items-center justify-between">
							<span>{item.quantity} × {item.name}</span>
							<span class="text-xs text-gray-400">{item.status}</span>
						</li>
					{/each}
				</ul>
			</div>

			<div class="flex flex-wrap gap-2">
				{#if selected.status === 'NEW'}
					<Button onclick={() => transition('ACCEPTED')}>Accept</Button>
				{/if}
				{#if selected.status === 'ACCEPTED'}
					<Button onclick={() => transition('PREPARING')}>Start preparing</Button>
				{/if}
				{#if selected.status === 'PREPARING' || selected.status === 'ACCEPTED' || selected.status === 'NEW'}
					<Button variant="danger" onclick={() => transition('CANCELLED')}>Cancel</Button>
				{/if}
			</div>
		</div>
	</Modal>
{/if}

{#if showManage && canManage}
	<Modal title="Manage stations" onClose={() => (showManage = false)}>
		<div class="space-y-4">
			<div>
				<label for="mk-outlet" class="mb-1 block text-sm text-gray-600">Outlet</label>
				<select id="mk-outlet" bind:value={newStationOutlet} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
					{#each outlets as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
				</select>
			</div>
			<div>
				<label for="mk-name" class="mb-1 block text-sm text-gray-600">Station name</label>
				<input id="mk-name" bind:value={newStationName} placeholder="e.g. Expo" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
			</div>
			<div class="flex gap-2">
				<div class="flex-1">
					<label for="mk-sla" class="mb-1 block text-sm text-gray-600">Prep SLA (min)</label>
					<input id="mk-sla" bind:value={newStationSla} type="number" min="1" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
				<div class="w-24">
					<label for="mk-sort" class="mb-1 block text-sm text-gray-600">Sort</label>
					<input id="mk-sort" bind:value={newStationSort} type="number" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
				<div class="flex items-end">
					<Button onclick={addStation}>Add</Button>
				</div>
			</div>
		</div>
	</Modal>
{/if}
