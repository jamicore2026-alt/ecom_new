<script lang="ts">
	import { onMount } from 'svelte'
	import { api, getSelectedOutletId } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { currency, dateTime } from '$lib/format'

	type CashMovement = { amount: number; reason?: string; at: string }

	type RegisterShift = {
		id: string
		outletId: string | null
		openedBy: string
		openBank: number
		status: 'open' | 'closed'
		drops: CashMovement[]
		payouts: CashMovement[]
		expectedCash: number | null
		actualCash: number | null
		closedBy: string | null
		openedAt: string
		closedAt: string | null
	}

	type ZReport = {
		shiftId: string
		outletId: string | null
		openedAt: string
		closedAt: string
		openBank: number
		cashSales: number
		cashSalesCount: number
		dropsTotal: number
		payoutsTotal: number
		expectedCash: number
		actualCash: number
		variance: number
	}

	const canOperate = $derived(session.can('payments.create'))

	let outlets = $state<{ id: string; name: string }[]>([])
	let outletId = $state('')
	let shifts = $state<RegisterShift[]>([])
	let current = $state<RegisterShift | null>(null)
	let loading = $state(true)

	let openBank = $state('0')
	let opening = $state(false)

	let showMovement = $state<'drop' | 'payout' | null>(null)
	let moveAmount = $state('')
	let moveReason = $state('')

	let actualCash = $state('')
	let closing = $state(false)
	let lastReport = $state<ZReport | null>(null)

	function sessionOutletId(): string | null {
		return session.selectedOutletId ?? getSelectedOutletId()
	}

	async function loadAll() {
		loading = true
		try {
			const o = await api.get<{ success: boolean; data: { id: string; name: string }[] }>('/api/outlets')
			outlets = o.data
			if (!outletId) outletId = sessionOutletId() ?? outlets[0]?.id ?? ''
			await loadShifts()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function loadShifts() {
		if (!outletId) {
			shifts = []
			current = null
			return
		}
		try {
			const [list, cur] = await Promise.all([
				api.get<{ success: boolean; data: { items: RegisterShift[] } }>('/api/register-shifts', { outletId, limit: 50 }),
				api.get<{ success: boolean; data: RegisterShift | null }>('/api/register-shifts/current', { outletId })
			])
			shifts = list.data.items
			current = cur.data
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function openShift() {
		const bank = Number(openBank)
		if (!outletId) return toast.error('Select an outlet')
		if (!Number.isFinite(bank) || bank < 0) return toast.error('Opening bank must be >= 0')
		opening = true
		try {
			await api.post('/api/register-shifts/open', { outletId, openBank: bank })
			toast.success('Shift opened')
			openBank = '0'
			await loadShifts()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			opening = false
		}
	}

	async function recordMovement() {
		if (!current || !showMovement) return
		const amount = Number(moveAmount)
		if (!Number.isFinite(amount) || amount <= 0) return toast.error('Amount must be > 0')
		try {
			await api.post(`/api/register-shifts/${current.id}/${showMovement}`, {
				amount,
				...(moveReason ? { reason: moveReason } : {})
			})
			toast.success(showMovement === 'drop' ? 'Drop recorded' : 'Payout recorded')
			showMovement = null
			moveAmount = ''
			moveReason = ''
			await loadShifts()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function closeShift() {
		if (!current) return
		const counted = Number(actualCash)
		if (!Number.isFinite(counted) || counted < 0) return toast.error('Counted cash is required to close')
		closing = true
		try {
			const res = await api.post<{ success: boolean; data: { shift: RegisterShift; zReport: ZReport } }>(
				`/api/register-shifts/${current.id}/close`,
				{ actualCash: counted }
			)
			lastReport = res.data.zReport
			toast.success('Shift closed')
			actualCash = ''
			await loadShifts()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			closing = false
		}
	}

	const sumOf = (rows: CashMovement[] | null | undefined) =>
		(rows ?? []).reduce((a, m) => a + Number(m.amount), 0)

	onMount(loadAll)
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-bold">Cash Drawer Shifts</h1>
			<p class="text-sm text-secondary">Open bank, safe drops, payouts and Z-report close per outlet.</p>
		</div>
		<label class="flex items-center gap-2 text-sm">
			Outlet
			<select class="rounded border px-2 py-1" bind:value={outletId} onchange={loadShifts}>
				{#each outlets as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
			</select>
		</label>
	</div>

	{#if loading}
		<p class="text-sm text-secondary">Loading…</p>
	{:else if current}
		<Card>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p class="font-semibold">Open shift · since {dateTime(current.openedAt)}</p>
					<p class="text-sm text-secondary">
						Open bank {currency(Number(current.openBank))} ·
						Drops {currency(sumOf(current.drops))} ·
						Payouts {currency(sumOf(current.payouts))}
					</p>
				</div>
				{#if canOperate}
					<div class="flex gap-2">
						<Button variant="secondary" onclick={() => (showMovement = 'drop')}>Record drop</Button>
						<Button variant="secondary" onclick={() => (showMovement = 'payout')}>Record payout</Button>
					</div>
				{/if}
			</div>

			{#if canOperate}
				<div class="mt-4 flex flex-wrap items-end gap-2">
					<label class="text-sm">
						Counted cash
						<input
							class="ml-2 w-32 rounded border px-2 py-1"
							type="number"
							min="0"
							step="0.01"
							bind:value={actualCash}
							placeholder="0.00"
						/>
					</label>
					<Button onclick={closeShift} disabled={closing}>{closing ? 'Closing…' : 'Close shift + Z-report'}</Button>
				</div>
			{/if}
		</Card>
	{:else}
		<Card>
			<p class="text-sm text-secondary">No open shift for this outlet.</p>
			{#if canOperate}
				<div class="mt-3 flex flex-wrap items-end gap-2">
					<label class="text-sm">
						Opening bank
						<input
							class="ml-2 w-32 rounded border px-2 py-1"
							type="number"
							min="0"
							step="0.01"
							bind:value={openBank}
							placeholder="0.00"
						/>
					</label>
					<Button onclick={openShift} disabled={opening || !outletId}>{opening ? 'Opening…' : 'Open shift'}</Button>
				</div>
			{/if}
		</Card>
	{/if}

	{#if lastReport}
		<Card>
			<h2 class="font-semibold">Z-report · {dateTime(lastReport.closedAt)}</h2>
			<dl class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
				<dt class="text-secondary">Open bank</dt><dd class="text-right">{currency(lastReport.openBank)}</dd>
				<dt class="text-secondary">Cash sales ({lastReport.cashSalesCount})</dt><dd class="text-right">{currency(lastReport.cashSales)}</dd>
				<dt class="text-secondary">Drops</dt><dd class="text-right">{currency(lastReport.dropsTotal)}</dd>
				<dt class="text-secondary">Payouts</dt><dd class="text-right">{currency(lastReport.payoutsTotal)}</dd>
				<dt class="text-secondary">Expected</dt><dd class="text-right">{currency(lastReport.expectedCash)}</dd>
				<dt class="text-secondary">Counted</dt><dd class="text-right">{currency(lastReport.actualCash)}</dd>
				<dt class="font-semibold">Variance</dt><dd class="text-right font-semibold">{currency(lastReport.variance)}</dd>
			</dl>
		</Card>
	{/if}

	<Card>
		<h2 class="font-semibold">Shift history</h2>
		{#if shifts.length === 0}
			<p class="mt-2 text-sm text-secondary">No shifts yet for this outlet.</p>
		{:else}
			<ul class="mt-2 divide-y text-sm">
				{#each shifts as s (s.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-2">
						<span>
							<span class="rounded px-1.5 py-0.5 text-xs ring-1 {s.status === 'open' ? 'bg-success/10 text-success ring-success' : 'bg-secondary/10 text-secondary ring-secondary'}">
								{s.status.toUpperCase()}
							</span>
							<span class="ml-2">{dateTime(s.openedAt)}{s.closedAt ? ` → ${dateTime(s.closedAt)}` : ''}</span>
						</span>
						<span class="text-secondary">
							Bank {currency(Number(s.openBank))}
							{#if s.expectedCash !== null} · Expected {currency(Number(s.expectedCash))}{/if}
							{#if s.actualCash !== null} · Counted {currency(Number(s.actualCash))}{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>

<Modal open={showMovement !== null} title={showMovement === 'drop' ? 'Record safe drop' : 'Record payout'} onClose={() => (showMovement = null)}>
	<div class="space-y-3">
		<label class="block text-sm">
			Amount
			<input class="mt-1 w-full rounded border px-2 py-1" type="number" min="0" step="0.01" bind:value={moveAmount} placeholder="0.00" />
		</label>
		<label class="block text-sm">
			Reason (optional)
			<input class="mt-1 w-full rounded border px-2 py-1" bind:value={moveReason} placeholder="e.g. mid-day safe drop" />
		</label>
		<div class="flex justify-end gap-2">
			<Button variant="secondary" onclick={() => (showMovement = null)}>Cancel</Button>
			<Button onclick={recordMovement}>Save</Button>
		</div>
	</div>
</Modal>
