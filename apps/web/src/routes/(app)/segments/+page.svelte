<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { currency, dateTime, number } from '$lib/format'
	import type { Segment, SegmentDefinition } from '$lib/types'

	type Field = 'minSpent' | 'minOrders'
	type Operator = 'gt' | 'gte'

	let segments = $state<Segment[]>([])
	let loading = $state(true)
	let saving = $state(false)

	let showModal = $state(false)
	let editing = $state<Segment | null>(null)
	let fName = $state('')
	let rules = $state<Array<{ field: Field; op: Operator; value: string }>>([{ field: 'minSpent', op: 'gte', value: '' }])
	let previewCount = $state<number | null>(null)

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Segment[] } }>('/api/segments')
			segments = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	const canWrite = () => session.can('settings:write')

	function definitionFromRules(): SegmentDefinition {
		const def: SegmentDefinition = {}
		for (const r of rules) {
			const v = Number(r.value)
			if (!Number.isFinite(v)) continue
			if (r.field === 'minSpent') def.minSpent = Math.round(v * 100) / 100
			else def.minOrders = Math.round(v)
		}
		return def
	}

	async function preview() {
		try {
			const res = await api.post<{ success: boolean; data: { count: number } }>('/api/segments/preview', { definition: definitionFromRules() })
			previewCount = res.data.count
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function openCreate() {
		if (!canWrite()) {
			toast.error('You need the settings:write permission to manage segments')
			return
		}
		editing = null
		fName = ''
		rules = [{ field: 'minSpent', op: 'gte', value: '' }]
		previewCount = null
		showModal = true
	}

	function openEdit(s: Segment) {
		if (!canWrite()) return
		editing = s
		fName = s.name
		rules = []
		if (s.definition.minSpent != null) rules.push({ field: 'minSpent', op: 'gte', value: String(s.definition.minSpent) })
		if (s.definition.minOrders != null) rules.push({ field: 'minOrders', op: 'gte', value: String(s.definition.minOrders) })
		if (rules.length === 0) rules.push({ field: 'minSpent', op: 'gte', value: '' })
		previewCount = s.customerCount
		showModal = true
	}

	async function save() {
		if (!fName.trim()) {
			toast.error('Segment name is required')
			return
		}
		saving = true
		try {
			const body = { name: fName.trim(), definition: definitionFromRules() }
			if (editing) {
				await api.put(`/api/segments/${editing.id}`, body)
				toast.success('Segment updated')
			} else {
				await api.post('/api/segments', body)
				toast.success('Segment created')
			}
			showModal = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function remove(s: Segment) {
		if (!confirm(`Delete segment "${s.name}"?`)) return
		try {
			await api.delete(`/api/segments/${s.id}`)
			toast.success('Segment deleted')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function ruleSummary(s: Segment) {
		const parts: string[] = []
		if (s.definition.minSpent != null) parts.push(`spent ≥ ${currency(s.definition.minSpent)}`)
		if (s.definition.minOrders != null) parts.push(`${s.definition.minOrders}+ orders`)
		return parts.length ? parts.join(' · ') : 'No conditions'
	}
</script>

<svelte:head>
	<title>Customer Segments — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Customer Segments</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage and build rules to group your customers.</p>
		</div>
		{#if canWrite()}
			<Button size="sm" onclick={openCreate}><Icon name="add" size="text-[16px]" /> New segment</Button>
		{/if}
	</div>

	{#if loading}
		<div class="grid gap-4">
			{#each Array(3) as _}
				<div class="h-24 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if segments.length === 0}
		<Card>
			<div class="flex flex-col items-center gap-3 py-16 text-center">
				<Icon name="filter_alt_off" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No segments yet. Create your first dynamic segment.</p>
			</div>
		</Card>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			{#each segments as s (s.id)}
				<Card>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="font-medium text-on-surface">{s.name}</p>
							<p class="mt-0.5 text-xs text-secondary">{ruleSummary(s)}</p>
						</div>
						{#if canWrite()}
							<div class="flex shrink-0 items-center gap-1">
								<button class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => openEdit(s)} aria-label="Edit segment"><Icon name="edit" size="text-[18px]" /></button>
								<button class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => remove(s)} aria-label="Delete segment"><Icon name="delete" size="text-[18px]" /></button>
							</div>
						{/if}
					</div>
					<div class="mt-4 flex items-center justify-between border-t border-outline-variant/60 pt-3">
						<span class="flex items-center gap-1.5 text-sm text-secondary"><Icon name="group" size="text-[16px]" /> {number(s.customerCount)} members</span>
						<span class="text-xs text-secondary">Updated {dateTime(s.updatedAt)}</span>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>

{#if showModal}
	<Modal title={editing ? `Edit segment` : 'New segment'} open={true} onClose={() => (showModal = false)}>
		<div class="space-y-5">
			<div>
				<label class="field-label" for="seg-name">Segment name</label>
				<input id="seg-name" class="field" bind:value={fName} placeholder="e.g. Big Spenders" />
			</div>

			<div>
				<p class="field-label">Match customers that meet all of the following</p>
				<div class="space-y-2">
					{#each rules as r, i (i)}
						<div class="flex flex-wrap items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest p-3">
							<select class="field w-auto" bind:value={rules[i].field}>
								<option value="minSpent">Total spent</option>
								<option value="minOrders">Order count</option>
							</select>
							<select class="field w-auto" bind:value={rules[i].op}>
								<option value="gte">is at least</option>
							</select>
							<input class="field w-28" bind:value={rules[i].value} placeholder={rules[i].field === 'minSpent' ? '500.00' : '3'} type="number" step={rules[i].field === 'minSpent' ? '0.01' : '1'} min="0" />
							<button class="ml-auto rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => { rules = rules.filter((_, j) => j !== i) }} aria-label="Remove condition"><Icon name="close" size="text-[18px]" /></button>
						</div>
					{/each}
				</div>
				<button class="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => rules = [...rules, { field: 'minSpent', op: 'gte', value: '' }]}>
					<Icon name="add" size="text-[16px]" /> Add condition
				</button>
			</div>

			<div class="flex items-center justify-between rounded border border-outline-variant bg-surface-container-lowest p-3">
				<button class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={preview}>
					<Icon name="visibility" size="text-[16px]" /> Preview
				</button>
				<span class="text-sm text-secondary">{previewCount == null ? 'No estimate yet' : `${number(previewCount)} matching customers`}</span>
			</div>

			<div class="flex justify-end gap-2 border-t border-outline-variant/60 pt-4">
				<Button variant="secondary" size="sm" onclick={() => (showModal = false)}>Cancel</Button>
				<Button size="sm" onclick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create segment'}</Button>
			</div>
		</div>
	</Modal>
{/if}