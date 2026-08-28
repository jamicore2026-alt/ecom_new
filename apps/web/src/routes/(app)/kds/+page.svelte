<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import type { KdsBoard, KdsTicket, KotStatus } from '$lib/types'

	const canManage = $derived(session.can('kds.manage'))

	const STATUS_TONE: Record<string, string> = {
		NEW: 'bg-amber-100 text-amber-800 ring-amber-200',
		ACCEPTED: 'bg-sky-100 text-sky-800 ring-sky-200',
		PREPARING: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
		READY: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
		RECALLED: 'bg-rose-100 text-rose-800 ring-rose-200'
	}

	let board = $state<KdsBoard>({ stations: [], delayedCount: 0 })
	let loading = $state(true)
	let timer: ReturnType<typeof setInterval> | null = null
	let now = $state(Date.now())

	function refreshAge() {
		now = Date.now()
	}

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: KdsBoard }>('/api/kitchen/kds')
			board = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	function fmt(sec: number) {
		const m = Math.floor(sec / 60)
		const s = sec % 60
		return `${m}:${String(s).padStart(2, '0')}`
	}

	function ageClass(ticket: KdsTicket) {
		if (ticket.delayed) return 'text-rose-600'
		if (ticket.status === 'NEW' || ticket.status === 'ACCEPTED' || ticket.status === 'PREPARING') return 'text-gray-700'
		return 'text-gray-400'
	}

	async function act(ticket: KdsTicket, status: KotStatus) {
		if (!canManage) return
		try {
			await api.post<{ success: boolean }>(`/api/kitchen/tickets/${ticket.id}/status`, { status })
			toast.success(`#${ticket.orderNumber} → ${status}`)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function bump(ticket: KdsTicket) {
		if (!canManage) return
		try {
			await api.post<{ success: boolean }>(`/api/kitchen/tickets/${ticket.id}/bump`)
			toast.success(`#${ticket.orderNumber} marked ready`)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function recall(ticket: KdsTicket) {
		if (!canManage) return
		try {
			await api.post<{ success: boolean }>(`/api/kitchen/tickets/${ticket.id}/recall`)
			toast.success(`#${ticket.orderNumber} recalled`)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function itemDone(ticket: KdsTicket, itemId: string, status: 'READY' | 'DONE' | 'CANCELLED') {
		if (!canManage) return
		try {
			await api.post<{ success: boolean }>(`/api/kitchen/tickets/${ticket.id}/items/${itemId}/status`, { status })
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(() => {
		load()
		timer = setInterval(refreshAge, 1000)
		return () => {
			if (timer) clearInterval(timer)
		}
	})
</script>

<svelte:head><title>Kitchen Display</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold text-gray-900">Kitchen Display</h1>
			<p class="text-sm text-gray-500">Live preparation board by station.</p>
		</div>
		{#if board.delayedCount > 0}
			<span class="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-200">{board.delayedCount} delayed</span>
		{/if}
	</div>

	{#if loading && board.stations.length === 0}
		<div class="py-10 text-center text-sm text-gray-500">Loading board…</div>
	{/if}

	<div class="grid gap-4 lg:grid-cols-3 xl:grid-cols-4">
		{#each board.stations as station (station.id)}
			{#if station.tickets.length > 0}
				<section class="rounded-2xl border border-gray-200 bg-gray-50 p-3">
					<header class="mb-3 flex items-center justify-between">
						<h2 class="font-bold text-gray-900">{station.name}</h2>
						<span class="text-xs text-gray-500">{station.tickets.length} · SLA {station.prepSlaMin}m</span>
					</header>
					<div class="space-y-3">
						{#each station.tickets as ticket (ticket.id)}
							<article class="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
								<div class="flex items-start justify-between gap-2">
									<div>
										<div class="font-bold text-gray-900">#{ticket.orderNumber}</div>
										<div class="text-xs text-gray-500">
											<span class="font-mono {ageClass(ticket)}">{fmt(ticket.ageSec)}</span>
											{#if ticket.tableName}<span> · {ticket.tableName}</span>{/if}
											<span class="ml-1">· {ticket.priority}</span>
										</div>
									</div>
									<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[ticket.status]}">{ticket.status}</span>
								</div>

								<ul class="mt-2 space-y-1.5 text-sm">
									{#each ticket.items as item (item.id)}
										<li>
											<div class="flex items-center justify-between">
												<span class="font-medium text-gray-800">{item.quantity} × {item.name}</span>
												{#if canManage && ticket.status !== 'READY' && item.status === 'PENDING'}
													<button type="button" class="rounded border border-emerald-300 px-1.5 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50" onclick={() => itemDone(ticket, item.id, 'READY')}>Done</button>
												{/if}
											</div>
											{#if item.modifiers.length > 0}
												<div class="ml-4 text-xs text-gray-500">
													{#each item.modifiers as m (m.name)}
														<span class="mr-2">{m.quantity > 1 ? `${m.quantity}× ` : ''}{m.groupName}: {m.name}</span>
													{/each}
												</div>
											{/if}
										</li>
									{/each}
								</ul>

								{#if canManage}
									<div class="mt-3 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2">
										{#if ticket.status === 'NEW'}
											<button type="button" class="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700" onclick={() => act(ticket, 'ACCEPTED')}>Accept</button>
										{/if}
										{#if ticket.status === 'ACCEPTED'}
											<button type="button" class="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700" onclick={() => act(ticket, 'PREPARING')}>Start</button>
										{/if}
										{#if ticket.status === 'PREPARING' || ticket.status === 'ACCEPTED'}
											<button type="button" class="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700" onclick={() => bump(ticket)}>Ready</button>
											<button type="button" class="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50" onclick={() => recall(ticket)}>Recall</button>
										{/if}
										{#if ticket.status === 'RECALLED'}
											<button type="button" class="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700" onclick={() => act(ticket, 'ACCEPTED')}>Accept</button>
										{/if}
										{#if ticket.status === 'READY'}
											<button type="button" class="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50" onclick={() => act(ticket, 'PREPARING')}>Re-prep</button>
										{/if}
									</div>
								{/if}
							</article>
						{/each}
					</div>
				</section>
			{/if}
		{/each}
	</div>

	{#if !loading && board.stations.every((s) => s.tickets.length === 0)}
		<div class="py-10 text-center text-sm text-gray-500">No active tickets on the board.</div>
	{/if}
</div>
