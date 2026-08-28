<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
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

<div class="space-y-5">
	<div>
		<h1 class="text-xl font-bold text-gray-900">Audit Log</h1>
		<p class="text-sm text-gray-500">{meta.total} recorded events</p>
	</div>

	<Card padded={false}>
		<div class="flex flex-wrap items-center gap-2 px-5 py-3">
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={entityType} onchange={applyFilters}>
				<option value="">All entity types</option>
				{#each entityTypes as t (t)}
					<option value={t}>{t}</option>
				{/each}
			</select>
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={action} onchange={applyFilters}>
				<option value="">All actions</option>
				{#each [...new Set(items.map((i) => i.action))] as a (a)}
					<option value={a}>{fmtAction(a)}</option>
				{/each}
			</select>
			<button
				type="button"
				class="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
				onclick={clearFilters}
			>
				Clear
			</button>
		</div>
	</Card>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(5) as _}
					<div class="h-14 animate-pulse rounded-lg bg-gray-100"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<p class="py-14 text-center text-sm text-gray-400">No audit events found.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
						<tr>
							<th class="px-5 py-3 font-medium">Time</th>
							<th class="px-5 py-3 font-medium">Actor</th>
							<th class="px-5 py-3 font-medium">Action</th>
							<th class="px-5 py-3 font-medium">Entity</th>
							<th class="px-5 py-3 font-medium">Details</th>
							<th class="px-5 py-3 font-medium">IP</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-50">
						{#each items as entry (entry.id)}
							<tr class="align-top hover:bg-gray-50/60">
								<td class="whitespace-nowrap px-5 py-3 text-gray-500">{dateTimeFull(entry.createdAt)}</td>
								<td class="px-5 py-3">
									<span class="font-medium text-gray-900">{entry.actorName ?? 'System'}</span>
									{#if entry.actorUserId}
										<span class="block text-xs text-gray-400">{entry.actorUserId}</span>
									{/if}
								</td>
								<td class="px-5 py-3">
									<span class="inline-flex rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
										{fmtAction(entry.action)}
									</span>
								</td>
								<td class="px-5 py-3">
									{#if entry.entityType}
										<span class="text-xs font-medium capitalize text-gray-500">{entry.entityType}</span>
										{#if entry.entityId}
											<span class="block text-xs text-gray-400">{entry.entityId}</span>
										{/if}
									{:else}
										<span class="text-gray-300">—</span>
									{/if}
								</td>
								<td class="max-w-xs px-5 py-3">
									{#if metaSummary(entry)}
										<span class="block truncate text-xs text-gray-500" title={metaSummary(entry)}>{metaSummary(entry)}</span>
									{:else}
										<span class="text-gray-300">—</span>
									{/if}
								</td>
								<td class="whitespace-nowrap px-5 py-3">
									<span class="text-xs text-gray-400">{entry.ipAddress ?? '—'}</span>
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
