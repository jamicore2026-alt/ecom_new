<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { currency, dateTime, number } from '$lib/format'
	import { t } from '$lib/i18n'
	import type { Customer, PaginationMeta } from '$lib/types'

	let items = $state<Customer[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let search = $state('')
	let tag = $state('')
	let sortBy = $state('created_at')
	let sortOrder = $state('desc')
	let page = $state(1)

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
	<title>{t('customers.title')} — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">{t('customers.title')}</h1>
			<p class="mt-1 text-body-sm text-secondary">{meta.total} {t('common.total')}</p>
		</div>
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
		{:else}
			<div class="overflow-x-auto">
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
						{#each items as c (c.id)}
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