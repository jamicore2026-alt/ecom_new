<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import { currency, dateTime, number, titleCase } from '$lib/format'
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

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold text-gray-900">Customers</h1>
			<p class="text-sm text-gray-500">{meta.total} total</p>
		</div>
	</div>

	<Card padded={false}>
		<div class="flex flex-wrap items-center gap-3 px-5 py-3">
			<input
				class="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
				placeholder="Search name, email, phone…"
				bind:value={search}
				onkeydown={(e) => e.key === 'Enter' && applyFilters()}
			/>
			<input
				class="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
				placeholder="Tag (e.g. VIP)"
				bind:value={tag}
			/>
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={sortBy}>
				<option value="created_at">Newest</option>
				<option value="total_spent">Total spent</option>
				<option value="orders_count">Orders</option>
			</select>
			<select class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={sortOrder}>
				<option value="desc">Descending</option>
				<option value="asc">Ascending</option>
			</select>
			<Button variant="secondary" size="sm" onclick={applyFilters}>Apply</Button>
		</div>
	</Card>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(6) as _}
					<div class="h-12 animate-pulse rounded-lg bg-gray-100"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<p class="py-14 text-center text-sm text-gray-400">No customers found.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
							<th class="px-5 py-3">Customer</th>
							<th class="px-3 py-3">Contact</th>
							<th class="px-3 py-3">Tags</th>
							<th class="px-3 py-3">Orders</th>
							<th class="px-3 py-3">Total spent</th>
							<th class="px-3 py-3">Last order</th>
							<th class="px-5 py-3">Joined</th>
						</tr>
					</thead>
					<tbody>
						{#each items as c (c.id)}
							<tr class="border-b border-gray-50 hover:bg-gray-50/60">
								<td class="px-5 py-3">
									<a href="/customers/{c.id}" class="font-medium text-indigo-600 hover:text-indigo-800">
										{c.firstName ?? ''} {c.lastName ?? ''}
									</a>
								</td>
								<td class="px-3 py-3 text-gray-600">{c.email}{#if c.phone}<span class="text-gray-400"> · {c.phone}</span>{/if}</td>
								<td class="px-3 py-3">
									{#if c.tags.length}
										{#each c.tags as t (t)}
											<span class="mr-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{t}</span>
										{/each}
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</td>
								<td class="px-3 py-3 text-gray-700">{number(c.ordersCount)}</td>
								<td class="px-3 py-3 font-medium">{currency(c.totalSpent)}</td>
								<td class="px-3 py-3 text-gray-500">{c.lastOrderAt ? dateTime(c.lastOrderAt) : '—'}</td>
								<td class="px-5 py-3 text-gray-500">{dateTime(c.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {meta} {onPage} />
		{/if}
	</Card>
</div>