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
	import type { DiningTable, TableSection, TableSession } from '$lib/types'

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
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
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

	onMount(load)
</script>

<svelte:head><title>Tables &amp; Floor — Merchant OS</title></svelte:head>

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
								<button
									type="button"
									class="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-left transition hover:border-primary/40 hover:shadow-sm"
									onclick={() => (selected = table)}
								>
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
							<div class="flex gap-2">
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
