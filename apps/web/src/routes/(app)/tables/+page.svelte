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
	import type { DiningTable, FoodOrder, Reservation, TableSection, TableSession, TurnTimeRow } from '$lib/types'

	const canManage = $derived(session.can('tables.manage'))

	const STATUS_TONE: Record<string, string> = {
		AVAILABLE: 'bg-success/10 text-success ring-success',
		RESERVED: 'bg-info/10 text-info ring-info',
		OCCUPIED: 'bg-warning/10 text-warning ring-warning',
		ORDERING: 'bg-primary/10 text-primary ring-primary',
		DINING: 'bg-tertiary/10 text-tertiary ring-tertiary',
		BILL_REQUESTED: 'bg-warning/10 text-warning ring-warning',
		PAYMENT_PENDING: 'bg-error/10 text-error ring-error',
		CLEANING: 'bg-secondary/10 text-secondary ring-secondary'
	}

	let sections = $state<TableSection[]>([])
	let tables = $state<DiningTable[]>([])
	let sessions = $state<TableSession[]>([])
	let loading = $state(true)

	let selected = $state<DiningTable | null>(null)
	let showSeat = $state(false)
	let seatGuests = $state('2')
	let moveTo = $state('')
	let qr = $state<{ token: string; url: string; image: string } | null>(null)
	let showQr = $state(false)

	// create controls
	let showCreate = $state(false)
	let outlets = $state<{ id: string; name: string }[]>([])
	let newOutlet = $state('')
	let newSection = $state('')
	let newTableName = $state('')
	let newTableCode = $state('')
	let newTableSeats = $state('4')
	let sectionsByOutlet = $state<TableSection[]>([])

	// merge / split / status controls
	let showMerge = $state(false)
	let mergeTarget = $state('')
	let showSplit = $state(false)
	let splitTable = $state('')
	let splitGuests = $state('')
	let splitLines = $state<{ id: string; name: string; quantity: number; orderId: string }[]>([])
	let splitLineIds = $state<Set<string>>(new Set())

	// reservations
	let resDay = $state(new Date().toISOString().slice(0, 10))
	let reservations = $state<Reservation[]>([])
	let waitlist = $state<Reservation[]>([])
	let guestPhone = $state('')
	let guestHistory = $state<{ count: number; reservations: Reservation[] } | null>(null)
	let showRes = $state(false)
	let resName = $state('')
	let resPhone = $state('')
	let resParty = $state('2')
	let resAt = $state('')
	let resStatus = $state('booked')

	// turn-time report
	let turnTime = $state<TurnTimeRow[]>([])

	// floor editor
	let editFloor = $state(false)
	let dragId = $state<string | null>(null)

	async function load() {
		loading = true
		try {
			const [s, t] = await Promise.all([
				api.get<{ success: boolean; data: TableSection[] }>('/api/table-sections'),
				api.get<{ success: boolean; data: DiningTable[] }>('/api/tables')
			])
			const sv = await api.get<{ success: boolean; data: TableSession[] }>('/api/table-sessions?status=OPEN')
			sections = s.data
			tables = t.data
			sessions = sv.data
			await Promise.all([loadReservations(), loadTurnTime()])
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	function dayRange(day: string) {
		const from = new Date(`${day}T00:00:00`)
		const to = new Date(`${day}T23:59:59.999`)
		return { from: from.toISOString(), to: to.toISOString() }
	}

	async function loadReservations() {
		try {
			const { from, to } = dayRange(resDay)
			const [day, wl] = await Promise.all([
				api.get<{ success: boolean; data: Reservation[] }>(`/api/reservations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
				api.get<{ success: boolean; data: Reservation[] }>('/api/reservations/waitlist')
			])
			reservations = day.data
			waitlist = wl.data
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function loadTurnTime() {
		try {
			const r = await api.get<{ success: boolean; data: TurnTimeRow[] }>('/api/tables/reports/turn-time')
			turnTime = r.data
		} catch {
			turnTime = []
		}
	}

	async function searchGuest() {
		if (!guestPhone.trim()) return
		try {
			const r = await api.get<{ success: boolean; data: { count: number; reservations: Reservation[] } }>(
				`/api/reservations/history?phone=${encodeURIComponent(guestPhone.trim())}`
			)
			guestHistory = r.data
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function addReservation() {
		if (!resName.trim() || !resAt) return toast.error('Enter a name and time')
		try {
			await api.post('/api/reservations', {
				outletId: newOutlet || tables[0]?.outletId,
				guestName: resName.trim(),
				guestPhone: resPhone.trim() || undefined,
				partySize: Number(resParty) || 2,
				reservedAt: new Date(resAt).toISOString(),
				status: resStatus
			})
			toast.success('Reservation saved')
			showRes = false
			resName = ''
			resPhone = ''
			await loadReservations()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function setResStatus(r: Reservation, status: string) {
		try {
			await api.post(`/api/reservations/${r.id}/status`, { status })
			toast.success(`${r.guestName} → ${status}`)
			await loadReservations()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function assignResTable(r: Reservation, tableId: string) {
		if (!tableId) return
		try {
			await api.post(`/api/reservations/${r.id}/assign`, { tableId })
			toast.success(`Table assigned to ${r.guestName}`)
			await loadReservations()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	const sectionsWithTables = $derived.by(() => {
		const map = new Map<string, DiningTable[]>()
		for (const table of tables) {
			const key = table.sectionId ?? 'none'
			if (!map.has(key)) map.set(key, [])
			map.get(key)!.push(table)
		}
		return sections.map((s) => ({ section: s, tables: map.get(s.id) ?? [] }))
	})

	async function openSeat() {
		if (!selected || !canManage) return
		try {
			await api.post<{ success: boolean }>('/api/table-sessions', { tableId: selected.id, guests: Number(seatGuests) || 1 })
			toast.success(`Seated ${seatGuests || 1} at ${selected.name}`)
			showSeat = false
			selected = null
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function closeSession(id: string) {
		try {
			await api.post<{ success: boolean }>(`/api/table-sessions/${id}/close`)
			toast.success('Table closed — ready for cleaning')
			selected = null
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function cancelSession(id: string) {
		try {
			await api.post<{ success: boolean }>(`/api/table-sessions/${id}/cancel`)
			toast.success('Session cancelled')
			selected = null
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function doMove(id: string) {
		if (!moveTo) return
		try {
			await api.post<{ success: boolean }>(`/api/table-sessions/${id}/move`, { toTableId: moveTo })
			toast.success('Party moved')
			selected = null
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function showTableQr(id: string) {
		try {
			const res = await api.get<{ success: boolean; data: { token: string; url: string; image: string } }>(`/api/tables/${id}/qr`)
			qr = res.data
			showQr = true
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	const freeTables = $derived((Array.isArray(tables) ? tables : []).filter((t) => t.id !== selected?.id && ['AVAILABLE', 'RESERVED', 'CLEANING'].includes(t.status)))

	// create flow
	async function openCreate() {
		showCreate = true
		requestAnimationFrame(() => loadOutlets())
	}

	async function loadOutlets() {
		try {
			const o = await api.get<{ success: boolean; data: { id: string; name: string }[] }>('/api/outlets')
			outlets = o.data
			newOutlet = newOutlet || o.data[0]?.id || ''
			await refreshSections()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function refreshSections() {
		const s = await api.get<{ success: boolean; data: TableSection[] }>('/api/table-sections')
		sectionsByOutlet = s.data.filter((x) => x.outletId === newOutlet)
	}

	async function addSection() {
		if (!newSection) return toast.error('Enter a section name')
		try {
			await api.post<{ success: boolean }>('/api/table-sections', { outletId: newOutlet, name: newSection })
			toast.success('Section added')
			newSection = ''
			await refreshSections()
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function addTable() {
		if (!newTableName || !newTableCode) return toast.error('Enter a name and code')
		const firstSection = sectionsByOutlet[0]
		try {
			const body: Record<string, unknown> = { outletId: newOutlet, name: newTableName, code: newTableCode, seats: Number(newTableSeats) || 2 }
			if (firstSection) body.sectionId = firstSection.id
			await api.post<{ success: boolean }>('/api/tables', body)
			toast.success('Table added')
			newTableName = ''
			newTableCode = ''
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function deleteTable(id: string) {
		if (!confirm('Remove this table?')) return
		try {
			await api.delete<{ success: boolean }>(`/api/tables/${id}`)
			toast.success('Table removed')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	const TABLE_STATES = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'ORDERING', 'DINING', 'BILL_REQUESTED', 'PAYMENT_PENDING', 'CLEANING'] as const

	const mergeOptions = $derived((Array.isArray(sessions) ? sessions : []).filter((s) => s.status === 'OPEN' && s.id !== selected?.openSession?.id))

	async function doMerge() {
		const target = mergeOptions.find((s) => s.id === mergeTarget)
		const current = selected?.openSession
		if (!target || !current) return
		if (!confirm(`Merge ${selected?.name}'s party into ${target.tableName ?? 'the selected table'}?`)) return
		try {
			await api.post<{ success: boolean; data: TableSession }>(`/api/table-sessions/${target.id}/merge`, { sessionIds: [current.id] })
			toast.success(`Session merged into ${target.tableName ?? 'the selected table'}`)
			showMerge = false
			selected = null
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function openSplit() {
		splitTable = ''
		splitGuests = ''
		splitLineIds = new Set()
		splitLines = []
		showSplit = true
		const sid = selected?.openSession?.id
		if (!sid) return
		try {
			const detail = await api.get<{ success: boolean; data: TableSession }>(`/api/table-sessions/${sid}`)
			const orders = detail.data.orders ?? []
			const lines: typeof splitLines = []
			for (const o of orders as { orderNumber: string }[]) {
				// Resolve each attached order to its lines via food-orders lookup.
				const found = await api
					.get<{ success: boolean; data: { items: { id: string; name: string; quantity: number }[] } }>(
						`/api/food-orders?search=${encodeURIComponent((o as { orderNumber: string }).orderNumber)}`
					)
					.catch(() => null)
				const match = found?.data.items?.[0] as unknown as { id: string } | undefined
				if (!match) continue
				const full = await api.get<{ success: boolean; data: FoodOrder }>(`/api/food-orders/${match.id}`).catch(() => null)
				for (const l of full?.data.items ?? []) lines.push({ id: l.id, name: `${l.quantity}× ${l.name}`, quantity: l.quantity, orderId: match.id })
			}
			splitLines = lines
		} catch {
			splitLines = []
		}
	}

	function toggleSplitLine(id: string) {
		const next = new Set(splitLineIds)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		splitLineIds = next
	}

	async function doSplit() {
		const id = selected?.openSession?.id
		if (!id || !splitTable) return
		try {
			const body: Record<string, unknown> = { toTableId: splitTable, guests: Number(splitGuests) || 1 }
			if (splitLineIds.size > 0) body.orderItemIds = [...splitLineIds]
			const res = await api.post<{ success: boolean; data: { session: TableSession; splitInto: TableSession; movedLines: number } }>(`/api/table-sessions/${id}/split`, body)
			toast.success(
				`Split ${res.data.splitInto.guests} guests to ${res.data.splitInto.tableName ?? 'a new table'}` +
					(res.data.movedLines > 0 ? ` (+${res.data.movedLines} order line(s))` : '')
			)
			showSplit = false
			selected = null
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function floorDrop(e: DragEvent, container: HTMLElement) {
		e.preventDefault()
		if (!dragId) return
		const rect = container.getBoundingClientRect()
		const posX = Math.round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)))
		const posY = Math.round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)))
		const id = dragId
		dragId = null
		tables = tables.map((t) => (t.id === id ? { ...t, posX, posY } : t))
		api
			.put(`/api/tables/${id}/position`, { posX, posY })
			.then(() => toast.success('Table position saved'))
			.catch((err) => toast.error((err as Error).message))
	}

	const positionedTables = $derived(tables.filter((t) => t.posX !== null && t.posX !== undefined && t.posY !== null && t.posY !== undefined))

	async function setTableStatus(table: DiningTable, status: string) {
		try {
			await api.post<{ success: boolean; data: DiningTable }>(`/api/tables/${table.id}/status`, { status })
			toast.success(`${table.name} set to ${status}`)
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(load)
</script>

<svelte:head><title>Tables &amp; Floor — JamiCore</title></svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Tables &amp; Floor</h1>
			<p class="mt-1 text-body-sm text-secondary">Live dine-in floor, table sessions and per-table QR codes.</p>
		</div>
		{#if canManage}
			<Button onclick={openCreate}><Icon name="table_restaurant" size="text-[18px]" /> Manage floor</Button>
		{/if}
	</div>

	{#if turnTime.length > 0}
		<Card>
			<h2 class="mb-2 text-sm font-semibold text-on-surface">Turn time (open → close)</h2>
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
				{#each turnTime as row (`${row.outletId}-${row.sectionId}`)}
					<div class="rounded-lg bg-surface-container-low p-3 text-xs">
						<div class="font-semibold text-on-surface">{row.outletName ?? 'Outlet'} · {row.sectionName ?? 'No section'}</div>
						<div class="mt-1 text-secondary">avg <strong class="text-on-surface">{row.avgMin}m</strong> · median <strong class="text-on-surface">{row.medianMin}m</strong> · {row.sessions} session(s)</div>
					</div>
				{/each}
			</div>
		</Card>
	{/if}

	<Card>
		<div class="mb-2 flex items-center justify-between">
			<h2 class="text-sm font-semibold text-on-surface">Floor map</h2>
			{#if canManage}
				<Button size="sm" variant="secondary" onclick={() => (editFloor = !editFloor)}>{editFloor ? 'Done editing' : 'Edit floor'}</Button>
			{/if}
		</div>
		{#if positionedTables.length === 0}
			<p class="text-sm text-secondary">No positioned tables yet.{#if canManage && editFloor} Drag tables below onto the canvas; positions save on drop.{/if}</p>
		{/if}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative min-h-64 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-low {editFloor ? 'border-dashed' : ''}"
			style="height: 320px"
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => floorDrop(e, e.currentTarget)}
		>
			{#each positionedTables as t (t.id)}
				<div
					class="absolute flex h-16 w-24 cursor-move flex-col items-center justify-center rounded-lg border text-xs font-medium {editFloor ? 'border-primary bg-primary/10 text-on-surface' : 'border-outline-variant bg-surface-container-lowest text-on-surface-variant'}"
					style="left: calc({t.posX}% - 3rem); top: calc({t.posY}% - 2rem)"
					draggable={editFloor && canManage}
					ondragstart={() => (dragId = t.id)}
					title={`${t.name} — ${t.status}`}
				>
					<span>{t.name}</span>
					<span class="text-[10px] text-secondary">{t.status}</span>
				</div>
			{/each}
			{#if editFloor && canManage}
				<div class="absolute bottom-2 left-2 flex flex-wrap gap-1">
					{#each tables.filter((x) => x.posX === null || x.posX === undefined) as t (t.id)}
						<span class="cursor-grab rounded-full bg-surface-container-highest px-2 py-1 text-[11px] text-on-surface-variant" draggable="true" ondragstart={() => (dragId = t.id)}>{t.name}</span>
					{/each}
				</div>
			{/if}
		</div>
		{#if editFloor}<p class="mt-1 text-xs text-secondary">Drag a table onto the canvas — its position (percent) is saved on drop.</p>{/if}
	</Card>

	<Card>
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<h2 class="text-sm font-semibold text-on-surface">Reservations — day view</h2>
			<input type="date" class="field ml-auto w-auto" bind:value={resDay} onchange={loadReservations} aria-label="Reservation day" />
			{#if canManage}<Button size="sm" variant="secondary" onclick={() => { showRes = true; resAt = `${resDay}T19:00` }}>New booking</Button>{/if}
		</div>
		{#if reservations.length === 0}
			<p class="py-4 text-center text-sm text-secondary">No reservations this day.</p>
		{:else}
			<ul class="space-y-2">
				{#each reservations as r (r.id)}
					<li class="flex flex-wrap items-center gap-2 rounded-lg bg-surface-container-low p-2.5 text-sm">
						<span class="font-medium text-on-surface">{r.guestName}</span>
						<span class="text-xs text-secondary">{r.partySize} guests · {dateTime(r.reservedAt)}{r.tableName ? ` · ${r.tableName}` : ''}</span>
						<span class="inline-flex rounded-full bg-secondary/10 px-2 py-0.5 text-[10px] font-medium text-secondary ring-1 ring-inset ring-secondary">{r.status}</span>
						{#if canManage}
							<span class="ml-auto flex flex-wrap gap-1">
								{#each ['booked', 'seated', 'cancelled', 'no-show'] as st (st)}
									{#if st !== r.status}
										<button type="button" class="rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary-fixed-dim/40" onclick={() => setResStatus(r, st)}>{st}</button>
									{/if}
								{/each}
								<select class="field w-auto !py-1 text-xs" aria-label={`Assign table for ${r.guestName}`} onchange={(e) => assignResTable(r, e.currentTarget.value)} value={r.tableId ?? ''}>
									<option value="">Assign table…</option>
									{#each tables as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
								</select>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<div class="mt-4 grid gap-4 md:grid-cols-2">
			<div class="rounded-lg bg-surface-container-low p-3">
				<h3 class="text-sm font-semibold text-on-surface">Waitlist ({waitlist.length})</h3>
				{#if waitlist.length === 0}
					<p class="mt-1 text-xs text-secondary">Waitlist is empty.</p>
				{:else}
					<ul class="mt-2 space-y-1.5 text-sm">
						{#each waitlist as w (w.id)}
							<li class="flex items-center justify-between gap-2">
								<span class="text-on-surface-variant">{w.guestName} · {w.partySize}</span>
								{#if canManage}<button type="button" class="rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary-fixed-dim/40" onclick={() => setResStatus(w, 'booked')}>Book</button>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<div class="rounded-lg bg-surface-container-low p-3">
				<h3 class="text-sm font-semibold text-on-surface">Guest search</h3>
				<div class="mt-2 flex gap-2">
					<input class="field flex-1" bind:value={guestPhone} placeholder="Phone number" aria-label="Guest phone" />
					<Button size="sm" variant="secondary" onclick={searchGuest}>Search</Button>
				</div>
				{#if guestHistory}
					<p class="mt-2 text-xs text-secondary">{guestHistory.count} past reservation(s) for this guest.</p>
					<ul class="mt-1 max-h-32 space-y-1 overflow-y-auto text-xs text-on-surface-variant">
						{#each guestHistory.reservations as g (g.id)}
							<li>{g.guestName} · {dateTime(g.reservedAt)} · {g.status}</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</Card>

	{#if loading}
		<div class="py-10 text-center text-sm text-secondary">Loading floor…</div>
	{:else if sections.length === 0}
		<Card>
			<div class="flex flex-col items-center gap-2 py-10 text-center">
				<Icon name="table_restaurant" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No sections yet. Add one to start your floor.</p>
			</div>
		</Card>
	{:else}
		<div class="space-y-6">
			{#each sectionsWithTables as grp (grp.section.id)}
				<Card>
					<div class="mb-3 flex items-center justify-between">
						<h2 class="text-sm font-semibold text-on-surface">{grp.section.name}</h2>
						<span class="text-xs text-secondary">{grp.tables.filter((t) => t.status !== 'AVAILABLE').length} in use</span>
					</div>
					{#if grp.tables.length === 0}
						<p class="text-sm text-secondary">No tables in this section.</p>
					{:else}
						<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
							{#each grp.tables as table (table.id)}
								<div class="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest transition hover:border-primary/40 hover:shadow-sm">
									<button type="button" class="block w-full p-3 text-left" onclick={() => (selected = table)}>
										<div class="flex items-center justify-between">
											<span class="font-semibold text-on-surface">{table.name}</span>
											<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset {STATUS_TONE[table.status]}">{table.status}</span>
										</div>
										<div class="mt-2 text-xs text-secondary">
											<span>{table.code} · {table.seats} seats</span>
											{#if table.openSession}
												<span class="mt-0.5 block text-primary">{table.openSession.guests} guests · <span class="font-mono-label text-mono-label">${Number(table.total).toFixed(2)}</span></span>
											{/if}
										</div>
									</button>
									{#if canManage}
										<div class="border-t border-outline-variant px-3 py-2">
											<select
												class="field w-full"
												aria-label={`Change status for ${table.name}`}
												value={table.status}
												onchange={(e) => setTableStatus(table, (e.currentTarget as HTMLSelectElement).value)}
											>
												{#each TABLE_STATES as state (state)}
													<option value={state}>{state}</option>
												{/each}
											</select>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</Card>
			{/each}
		</div>
	{/if}
</div>

{#if selected}
	<Modal open={true} title={`${selected.name} — ${selected.status}`} onClose={() => (selected = null)}>
		<div class="space-y-4">
			<div class="flex items-center justify-between text-sm text-on-surface-variant">
				<span>{selected.code} · {selected.seats} seats</span>
				<button type="button" class="rounded px-1 py-0.5 font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => showTableQr(selected!.id)}>Show QR</button>
			</div>

			{#if selected.openSession}
				<div class="rounded-lg bg-surface-container-low p-3">
					<div class="flex items-center justify-between">
						<div>
							<div class="text-sm font-medium text-on-surface">Session open · {selected.openSession.guests} guests</div>
							<div class="text-xs text-secondary">Opened {dateTime(selected.openSession.openedAt)}{selected.openSession.notes ? ` · "${selected.openSession.notes}"` : ''}</div>
						</div>
						{#if canManage}
							<div class="flex flex-wrap justify-end gap-2">
								<Button size="sm" variant="secondary" onclick={() => { mergeTarget = ''; showMerge = true }}>Merge</Button>
								<Button size="sm" variant="secondary" onclick={() => { void openSplit() }}>Split</Button>
								<Button size="sm" variant="danger" onclick={() => cancelSession(selected!.openSession!.id)}>Cancel</Button>
								<Button size="sm" onclick={() => closeSession(selected!.openSession!.id)}>Close</Button>
							</div>
						{/if}
					</div>
					{#if selected.orderCount > 0}
						<div class="mt-2 text-xs text-on-surface-variant">{selected.orderCount} order(s) · <span class="font-mono-label text-mono-label">${Number(selected.total).toFixed(2)}</span></div>
					{/if}
				</div>

				{#if canManage && freeTables.length > 0}
					<div class="flex items-end gap-2">
						<div class="flex-1">
							<label for="move-to" class="field-label">Move party to</label>
							<select id="move-to" class="field" bind:value={moveTo}>
								<option value="" disabled>Choose a free table</option>
								{#each freeTables as t (t.id)}
									<option value={t.id}>{t.name} ({t.sectionName ?? '—'})</option>
								{/each}
							</select>
						</div>
						<Button variant="secondary" disabled={!moveTo} onclick={() => doMove(selected!.openSession!.id)}>Move</Button>
					</div>
				{/if}
			{:else}
				<p class="text-sm text-secondary">This table is free.</p>
				{#if canManage}
					<div class="flex items-end gap-2">
						<div class="w-24">
							<label for="seat-guests" class="field-label">Guests</label>
							<input id="seat-guests" class="field" bind:value={seatGuests} type="number" min="1" max={selected.seats} />
						</div>
						<Button onclick={() => { showSeat = true }}>Seat guests</Button>
						<Button variant="danger" onclick={() => deleteTable(selected!.id)}>Remove table</Button>
					</div>
				{/if}
			{/if}
		</div>
	</Modal>
{/if}

{#if showSeat && selected && !selected.openSession}
	<Modal open={true} title={`Seat ${selected.name}`} onClose={() => (showSeat = false)}>
		<div class="space-y-4">
			<label for="seat-guests-2" class="field-label">Guests</label>
			<input id="seat-guests-2" class="field" bind:value={seatGuests} type="number" min="1" max={selected.seats} />
			<div class="flex justify-end">
				<Button onclick={openSeat}>Open table</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if showMerge && selected?.openSession && canManage}
	<Modal open={true} title={`Merge ${selected.name}`} onClose={() => (showMerge = false)}>
		<div class="space-y-4">
			<p class="text-sm text-secondary">Move this session into another open session. Its orders and guests are combined, the source tables are cleared and this session closes.</p>
			<div>
				<label for="merge-into" class="field-label">Merge into</label>
				<select id="merge-into" class="field" bind:value={mergeTarget}>
					<option value="" disabled>Choose an open session</option>
					{#each mergeOptions as s (s.id)}
						<option value={s.id}>{s.tableName ?? 'Table'} ({s.guests} guests)</option>
					{/each}
				</select>
			</div>
			<div class="flex justify-end">
				<Button disabled={!mergeTarget} onclick={doMerge}>Merge</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if showSplit && selected?.openSession && canManage}
	<Modal open={true} title={`Split ${selected.name}`} onClose={() => (showSplit = false)}>
		<div class="space-y-4">
			<p class="text-sm text-secondary">Move some guests to a free table. A new session is opened there and this party keeps the rest. Tick order lines to move them to the new session too.</p>
			<div>
				<label for="split-table" class="field-label">Destination table</label>
				<select id="split-table" class="field" bind:value={splitTable}>
					<option value="" disabled>Choose a free table</option>
					{#each freeTables as t (t.id)}
						<option value={t.id}>{t.name} ({t.sectionName ?? '—'})</option>
					{/each}
				</select>
			</div>
			<div class="w-28">
				<label for="split-guests" class="field-label">Guests leaving</label>
				<input id="split-guests" class="field" bind:value={splitGuests} type="number" min="1" max={(selected.openSession?.guests ?? 1) - 1} />
			</div>
			{#if splitLines.length > 0}
				<div>
					<span class="mb-1 block text-xs text-secondary">Order lines to move</span>
					<ul class="max-h-40 space-y-1 overflow-y-auto rounded border border-outline-variant bg-surface-container-low p-2 text-sm">
						{#each splitLines as l (l.id)}
							<li>
								<label class="flex cursor-pointer items-center gap-2 text-on-surface-variant">
									<input type="checkbox" checked={splitLineIds.has(l.id)} onchange={() => toggleSplitLine(l.id)} />
									<span>{l.name}</span>
								</label>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			<div class="flex justify-end">
				<Button disabled={!splitTable} onclick={doSplit}>Split</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if showRes && canManage}
	<Modal open={true} title="New booking" onClose={() => (showRes = false)}>
		<div class="space-y-3">
			<div>
				<label for="res-name" class="field-label">Guest name</label>
				<input id="res-name" class="field" bind:value={resName} placeholder="e.g. Jane Doe" />
			</div>
			<div class="flex gap-2">
				<div class="flex-1">
					<label for="res-phone" class="field-label">Phone</label>
					<input id="res-phone" class="field" bind:value={resPhone} placeholder="555-0100" />
				</div>
				<div class="w-24">
					<label for="res-party" class="field-label">Party</label>
					<input id="res-party" class="field" type="number" min="1" bind:value={resParty} />
				</div>
			</div>
			<div class="flex gap-2">
				<div class="flex-1">
					<label for="res-at" class="field-label">Date & time</label>
					<input id="res-at" class="field" type="datetime-local" bind:value={resAt} />
				</div>
				<div class="w-32">
					<label for="res-status" class="field-label">Status</label>
					<select id="res-status" class="field" bind:value={resStatus}>
						<option value="booked">booked</option>
						<option value="waitlist">waitlist</option>
					</select>
				</div>
			</div>
			<div class="flex justify-end">
				<Button onclick={addReservation}>Save booking</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if showQr && qr}
	<Modal open={true} title="Table QR" onClose={() => (showQr = false)} width="sm">
		<div class="space-y-3 text-center">
			<div class="mx-auto flex h-40 w-40 items-center justify-center rounded-lg bg-surface-container-low text-4xl text-on-surface-variant" aria-hidden="true">▦</div>
			<p class="break-all text-xs text-secondary">{qr.url}</p>
			<p class="text-xs text-outline">Scan to open the public table menu — no account or private data required.</p>
		</div>
	</Modal>
{/if}

{#if showCreate && canManage}
	<Modal open={true} title="Manage floor" onClose={() => (showCreate = false)}>
		<div class="space-y-6">
			<div>
				<label for="cr-outlet" class="field-label">Outlet</label>
				<select id="cr-outlet" class="field" bind:value={newOutlet} onchange={refreshSections}>
					{#each outlets as o (o.id)}
						<option value={o.id}>{o.name}</option>
					{/each}
				</select>
			</div>

			<div class="rounded-lg bg-surface-container-low p-3">
				<h3 class="text-sm font-semibold text-on-surface">Add section</h3>
				<div class="mt-2 flex gap-2">
					<input class="field flex-1" bind:value={newSection} placeholder="e.g. Patio" />
					<Button variant="secondary" onclick={addSection}>Add</Button>
				</div>
			</div>

			<div class="rounded-lg bg-surface-container-low p-3">
				<h3 class="text-sm font-semibold text-on-surface">Add table</h3>
				<div class="mt-2 space-y-2">
					<input class="field" bind:value={newTableName} placeholder="Name (e.g. Table 5)" />
					<div class="flex gap-2">
						<input class="field w-1/2" bind:value={newTableCode} placeholder="Code (e.g. T05)" />
						<input class="field w-1/4" bind:value={newTableSeats} type="number" min="1" placeholder="Seats" />
						<div class="w-1/4">
							<Button onclick={addTable}>Add</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	</Modal>
{/if}
