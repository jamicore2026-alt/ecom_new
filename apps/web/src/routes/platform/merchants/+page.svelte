<script lang="ts">
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { platformApi } from '$lib/platform-api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { dateTimeFull } from '$lib/format'
	import { MERCHANT_STATUSES } from '$lib/types'
	import type { PlatformMerchantSummary, PaginationMeta } from '$lib/types'

	let items = $state<PlatformMerchantSummary[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let status = $state('')
	let search = $state('')
	let page = $state(1)

	async function load() {
		loading = true
		try {
			const res = await platformApi.listMerchants({ page, limit: 20, status: status || undefined, search: search || undefined })
			items = res.items
			meta = res.meta
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
		status = ''
		search = ''
		applyFilters()
	}
</script>

<svelte:head>
	<title>Merchants — JamiCore Admin</title>
</svelte:head>

<div class="mb-8">
	<h1 class="text-3xl font-bold tracking-tight text-on-surface">Merchants</h1>
	<p class="mt-1 text-sm text-secondary">{meta.total} stores on the platform</p>
</div>

<div class="rounded border border-outline-variant bg-surface-container-lowest p-3">
	<div class="flex flex-wrap items-center gap-2">
		<select class="field w-auto" bind:value={status} onchange={applyFilters}>
			<option value="">All statuses</option>
			{#each MERCHANT_STATUSES as s (s)}
				<option value={s}>{s}</option>
			{/each}
		</select>
		<input
			class="field min-w-52"
			type="search"
			placeholder="Search by name"
			bind:value={search}
			onkeydown={(e) => e.key === 'Enter' && applyFilters()}
		/>
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
			{#each Array(6) as _}
				<div class="h-14 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if items.length === 0}
		<div class="flex flex-col items-center gap-2 py-16 text-center">
			<Icon name="storefront" size="text-[32px]" class="text-outline" />
			<p class="text-sm text-secondary">No merchants match.</p>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
					<tr>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Store</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Email</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Currency</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Timezone</th>
						<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-outline-variant/60">
					{#each items as m (m.id)}
						<tr class="cursor-pointer transition-colors hover:bg-surface-container-low" onclick={() => goto(`/platform/merchants/${m.id}`)}>
							<td class="px-table-cell-x py-table-cell-y">
								<span class="font-medium text-on-surface">{m.name}</span>
								<span class="block text-xs text-outline">/{m.slug}</span>
							</td>
							<td class="px-table-cell-x py-table-cell-y"><Badge label={m.status} /></td>
							<td class="px-table-cell-x py-table-cell-y text-secondary">{m.email}</td>
							<td class="px-table-cell-x py-table-cell-y text-secondary">{m.currency}</td>
							<td class="px-table-cell-x py-table-cell-y text-secondary">{m.timezone}</td>
							<td class="whitespace-nowrap px-table-cell-x py-table-cell-y text-secondary">{dateTimeFull(m.createdAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<Pagination {meta} {onPage} />
	{/if}
</Card>