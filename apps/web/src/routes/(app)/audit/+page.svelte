<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { dateTimeFull } from '$lib/format'
	import type { AuditEntry, PaginationMeta } from '$lib/types'

	let items = $state<AuditEntry[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let action = $state('')
	let entityType = $state('')
	let page = $state(1)

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = { page: String(page) }
			if (action) params.action = action
			if (entityType) params.entityType = entityType
			const res = await api.get<{ success: boolean; data: { items: AuditEntry[]; meta: PaginationMeta } }>(
				'/api/audit',
				params
			)
			items = res.data.items
			meta = res.data.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function applyFilters() {
		page = 1
		load()
	}

	function onPage(p: number) {
		page = p
		load()
	}

	function clearFilters() {
		action = ''
		entityType = ''
		applyFilters()
	}

	const entityTypes = ['product', 'category', 'variant', 'order', 'inventory', 'review', 'coupon', 'promotion', 'staff', 'api_key', 'customer', 'auth']

	const fmtAction = (a: string) =>
		a
			.split('.')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1).replace(/_/g, ' '))
			.join(' · ')

	const metaSummary = (e: AuditEntry) => {
		const keys = Object.keys(e.metadata ?? {})
		if (keys.length === 0) return null
		return keys.map((k) => `${k}: ${JSON.stringify((e.metadata as Record<string, unknown>)[k])}`).join(' · ')
	}
</script>

<svelte:head>
	<title>Audit Log — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8">
		<h1 class="font-display text-display text-on-surface">Audit Log</h1>
		<p class="mt-1 text-body-sm text-secondary">{meta.total} recorded events</p>
	</div>

	<div class="rounded border border-outline-variant bg-surface-container-lowest p-3">
		<div class="flex flex-wrap items-center gap-2">
			<select class="field w-auto" bind:value={entityType} onchange={applyFilters}>
				<option value="">All entity types</option>
				{#each entityTypes as t (t)}
					<option value={t}>{t}</option>
				{/each}
			</select>
			<select class="field w-auto" bind:value={action} onchange={applyFilters}>
				<option value="">All actions</option>
				{#each [...new Set(items.map((i) => i.action))] as a (a)}
					<option value={a}>{fmtAction(a)}</option>
				{/each}
			</select>
			<button
				type="button"
				class="inline-flex items-center gap-1 rounded p-2 text-sm font-medium text-secondary hover:bg-surface-container hover:text-on-surface"
				onclick={clearFilters}
			>
				<Icon name="filter_alt_off" size="text-[16px]" />
				Clear
			</button>
		</div>
	</div>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(5) as _}
					<div class="h-14 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="history" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No audit events found.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
						<tr>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Time</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Actor</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Action</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Entity</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Details</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">IP</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-outline-variant/60">
						{#each items as entry (entry.id)}
							<tr class="align-top transition-colors hover:bg-surface-container-low">
								<td class="whitespace-nowrap px-table-cell-x py-table-cell-y text-secondary">{dateTimeFull(entry.createdAt)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<span class="font-medium text-on-surface">{entry.actorName ?? 'System'}</span>
									{#if entry.actorUserId}
										<span class="block text-xs text-outline">{entry.actorUserId}</span>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y">
									<span class="inline-flex rounded-full bg-primary-fixed-dim/30 px-2.5 py-0.5 text-xs font-medium text-on-primary-fixed-variant">
										{fmtAction(entry.action)}
									</span>
								</td>
								<td class="px-table-cell-x py-table-cell-y">
									{#if entry.entityType}
										<span class="text-xs font-medium capitalize text-secondary">{entry.entityType}</span>
										{#if entry.entityId}
											<span class="block text-xs text-outline">{entry.entityId}</span>
										{/if}
									{:else}
										<span class="text-outline">—</span>
									{/if}
								</td>
								<td class="max-w-xs px-table-cell-x py-table-cell-y">
									{#if metaSummary(entry)}
										<span class="block truncate text-xs text-on-surface-variant" title={metaSummary(entry)}>{metaSummary(entry)}</span>
									{:else}
										<span class="text-outline">—</span>
									{/if}
								</td>
								<td class="whitespace-nowrap px-table-cell-x py-table-cell-y">
									<span class="text-xs text-outline">{entry.ipAddress ?? '—'}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		{/if}
	</Card>
</div>
