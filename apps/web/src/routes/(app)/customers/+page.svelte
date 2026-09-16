<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { currency, dateTime, number, timeAgo } from '$lib/format'
	import { t } from '$lib/i18n'
	import { session } from '$lib/session.svelte'
	import type { Customer, PaginationMeta, Permission } from '$lib/types'

	let items = $state<Customer[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let search = $state('')
	let tag = $state('')
	let sortBy = $state('created_at')
	let sortOrder = $state('desc')
	let page = $state(1)

	// csv
	let exporting = $state(false)
	let importing = $state(false)
	let fileInput = $state<HTMLInputElement | null>(null)

	// tag chips — client-side filter over the loaded page (items include tags)
	let activeTag = $state('')
	const availableTags = $derived.by(() => {
		const counts = new Map<string, number>()
		for (const c of items) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
		return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
	})
	const visibleItems = $derived(activeTag ? items.filter((c) => c.tags.includes(activeTag)) : items)

	const canRead = () => session.can('customers.read')
	const canImport = () => session.can('customers.write' as unknown as Permission)

	async function exportCsv() {
		exporting = true
		try {
			await api.download('/api/customers/export', 'customers.csv')
			toast.success('Customers exported')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			exporting = false
		}
	}

	async function runImport(file: File) {
		importing = true
		try {
			const fd = new FormData()
			fd.append('file', file, file.name)
			const res = await api.upload<{
				success: boolean
				data: { created: number; updated: number; failed: number; errors: Array<{ line: number; message: string }> }
			}>('/api/customers/import', fd)
			toast.success(`Imported: ${res.data.created} created, ${res.data.updated} updated, ${res.data.failed} failed`)
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			importing = false
		}
	}

	function onFilePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const file = input.files?.[0]
		if (!file) return
		input.value = ''
		runImport(file)
	}

	function toggleTag(t: string) {
		activeTag = activeTag === t ? '' : t
	}

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = { page: String(page), sortBy, sortOrder }
			if (search) params.search = search
			if (tag) params.tag = tag
			const res = await api.get<{ success: boolean; data: { items: Customer[]; meta: PaginationMeta } }>(
				'/api/customers',
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
</script>

<svelte:head>
	<title>{t('customers.title')} — JamiCore</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">{t('customers.title')}</h1>
			<p class="mt-1 text-body-sm text-secondary">{meta.total} {t('common.total')}</p>
		</div>
		{#if canRead()}
			<div class="flex flex-wrap gap-2">
				<Button variant="secondary" size="sm" loading={exporting} onclick={exportCsv}><Icon name="download" size="text-[16px]" /> Export CSV</Button>
				{#if canImport()}
					<Button variant="secondary" size="sm" loading={importing} onclick={() => fileInput?.click()}><Icon name="file_upload" size="text-[16px]" /> Import CSV</Button>
				{/if}
			</div>
		{/if}
		<input type="file" accept=".csv" class="hidden" bind:this={fileInput} onchange={onFilePicked} />
	</div>

	<div class="rounded border border-outline-variant bg-surface-container-lowest p-3">
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-[200px] flex-1">
				<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
					<Icon name="search" size="text-[18px]" />
				</div>
				<input
					class="w-full rounded border border-outline-variant bg-surface-container-lowest py-2 pl-9 pr-3 text-sm text-on-surface placeholder:text-secondary focus:outline-2 focus:outline-primary"
					placeholder="Search name, email, phone…"
					bind:value={search}
					onkeydown={(e) => e.key === 'Enter' && applyFilters()}
				/>
			</div>
			<div class="relative">
				<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
					<Icon name="sell" size="text-[16px]" />
				</div>
				<input
					class="w-40 rounded border border-outline-variant bg-surface-container-lowest py-2 pl-9 pr-3 text-sm text-on-surface placeholder:text-secondary focus:outline-2 focus:outline-primary"
					placeholder="Tag (e.g. VIP)"
					bind:value={tag}
					onkeydown={(e) => e.key === 'Enter' && applyFilters()}
				/>
			</div>
			<select class="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary" bind:value={sortBy}>
				<option value="created_at">Newest</option>
				<option value="total_spent">Total spent</option>
				<option value="orders_count">Orders</option>
			</select>
			<select class="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:outline-2 focus:outline-primary" bind:value={sortOrder}>
				<option value="desc">Descending</option>
				<option value="asc">Ascending</option>
			</select>
			<Button variant="secondary" size="sm" onclick={applyFilters}>Apply</Button>
		</div>
	</div>

	{#if availableTags.length > 0}
		<div class="flex flex-wrap items-center gap-1.5">
			<button
				type="button"
				class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {activeTag === '' ? 'border-primary bg-primary-fixed-dim/40 text-on-primary-fixed-variant' : 'border-outline-variant bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}"
				onclick={() => (activeTag = '')}
			>All tags</button>
			{#each availableTags as [tag, count] (tag)}
				<button
					type="button"
					class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {activeTag === tag ? 'border-primary bg-primary-fixed-dim/40 text-on-primary-fixed-variant' : 'border-outline-variant bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}"
					onclick={() => toggleTag(tag)}
				>{tag} <span class="opacity-70">{count}</span></button>
			{/each}
		</div>
	{/if}

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="group" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No customers found.</p>
			</div>
		{:else if visibleItems.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="sell" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No customers match this tag.</p>
			</div>
		{:else}
			<div class="divide-y divide-outline-variant/60 md:hidden">
				{#each visibleItems as c (c.id)}
					<a href="/customers/{c.id}" class="block px-4 py-3 transition-colors hover:bg-surface-container-low">
						<div class="flex items-center justify-between gap-3">
							<p class="font-medium text-primary">{c.firstName ?? ''} {c.lastName ?? ''}</p>
							<span class="font-mono-label text-mono-label text-on-surface">{currency(c.totalSpent)}</span>
						</div>
						<p class="mt-1 text-xs text-secondary">{c.email}{#if c.phone}<span class="text-outline"> · {c.phone}</span>{/if}</p>
						<p class="mt-1 text-xs text-secondary">{number(c.ordersCount)} orders · {c.lastOrderAt ? 'Last ' + timeAgo(c.lastOrderAt) : 'No orders'}</p>
						{#if c.tags.length}
							<span class="mt-1.5 flex flex-wrap gap-1">
								{#each c.tags as t (t)}
									<span class="inline-block rounded-full border border-outline-variant bg-surface-container-low px-2 py-0.5 text-xs text-on-surface-variant">{t}</span>
								{/each}
							</span>
						{/if}
					</a>
				{/each}
			</div>
			<div class="hidden overflow-x-auto md:block">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Customer</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Contact</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Tags</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Orders</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Total spent</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Last order</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Joined</th>
						</tr>
					</thead>
					<tbody>
						{#each visibleItems as c (c.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<a href="/customers/{c.id}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">
										{c.firstName ?? ''} {c.lastName ?? ''}
									</a>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">
									{c.email}{#if c.phone}<span class="text-outline"> · {c.phone}</span>{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y">
									{#if c.tags.length}
										<span class="flex flex-wrap gap-1">
											{#each c.tags as t (t)}
												<span class="inline-block rounded-full border border-outline-variant bg-surface-container-low px-2 py-0.5 text-xs text-on-surface-variant">{t}</span>
											{/each}
										</span>
									{:else}
										<span class="text-outline">—</span>
									{/if}
								</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(c.ordersCount)}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(c.totalSpent)}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{c.lastOrderAt ? dateTime(c.lastOrderAt) : '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(c.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		{/if}
	</Card>
</div>