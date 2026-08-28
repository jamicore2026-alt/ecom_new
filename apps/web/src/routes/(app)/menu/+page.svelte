<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import type { MenuItem, MenuModifierGroup, MenuProductLite } from '$lib/types'

	const canWrite = $derived(session.can('menu.manage'))

	let items = $state<MenuItem[]>([])
	let groups = $state<MenuModifierGroup[]>([])
	let loading = $state(true)
	let search = $state('')

	let showCreate = $state(false)
	let products = $state<MenuProductLite[]>([])
	let productsLoading = $state(false)
	let productId = $state('')
	let prepTime = $state('15')
	let station = $state('Grill')
	let visible = $state(true)

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = {}
			if (search.trim()) params.search = search.trim()
			const res = await api.get<{ success: boolean; data: { items: MenuItem[] } }>('/api/menu', params)
			items = res.data.items
			const g = await api.get<{ success: boolean; data: MenuModifierGroup[] }>('/api/modifier-groups')
			groups = g.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function openCreate() {
		showCreate = true
		productId = ''
		visible = true
		productsLoading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: MenuProductLite[] } }>('/api/products', { limit: '100' })
			const onMenu = new Set(items.map((i) => i.product.id))
			products = res.data.items.filter((p) => !onMenu.has(p.id))
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			productsLoading = false
		}
	}

	async function createItem() {
		if (!productId) return toast.error('Select a product')
		try {
			await api.post<{ success: boolean }>('/api/menu', {
				productId,
				preparationTimeMin: Number(prepTime) || 0,
				kitchenStation: station,
				available: visible,
				status: 'active'
			})
			toast.success('Menu item added')
			showCreate = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function toggleAvailable(item: MenuItem) {
		try {
			await api.put<{ success: boolean }>(`/api/menu/${item.id}`, { available: !item.available })
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function archive(item: MenuItem) {
		if (!confirm(`Remove "${item.product.name}" from the menu?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/menu/${item.id}`)
			toast.success('Menu item removed')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}
</script>

<svelte:head><title>Menu</title></svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold text-gray-900">Food Menu</h1>
			<p class="text-sm text-gray-500">Restaurant items, modifiers and availability.</p>
		</div>
		{#if canWrite}
			<Button onclick={openCreate}>Add to menu</Button>
		{/if}
	</div>

	<Card>
		<div class="mb-4 flex items-center gap-3">
			<input
				bind:value={search}
				oninput={() => load()}
				placeholder="Search menu items…"
				class="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
			/>
			<span class="text-sm text-gray-500">{items.length} item{items.length === 1 ? '' : 's'}</span>
		</div>

		{#if loading}
			<div class="py-10 text-center text-sm text-gray-500">Loading menu…</div>
		{:else if items.length === 0}
			<div class="py-10 text-center text-sm text-gray-500">No menu items yet.</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
						<tr>
							<th class="py-2 pr-4">Item</th>
							<th class="py-2 pr-4">Price</th>
							<th class="py-2 pr-4">Station</th>
							<th class="py-2 pr-4">Prep</th>
							<th class="py-2 pr-4">Tags</th>
							<th class="py-2 pr-4">Status</th>
							<th class="py-2 text-right">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each items as item (item.id)}
							<tr class="hover:bg-gray-50">
								<td class="py-3 pr-4">
									<div class="font-medium text-gray-900">{item.product.name}</div>
									<div class="text-xs text-gray-400">{item.product.sku}</div>
								</td>
								<td class="py-3 pr-4">${Number(item.product.price).toFixed(2)}</td>
								<td class="py-3 pr-4">{item.kitchenStation ?? '—'}</td>
								<td class="py-3 pr-4">{item.preparationTimeMin}m</td>
								<td class="py-3 pr-4">
									<div class="flex flex-wrap gap-1">
										{#each item.dietaryTags ?? [] as t}
											<span class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">{t}</span>
										{/each}
									</div>
								</td>
								<td class="py-3 pr-4">
									{#if item.available}
										<span class="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">Available</span>
									{:else}
										<span class="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">Sold out</span>
									{/if}
								</td>
								<td class="py-3 text-right">
									{#if canWrite}
										<button onclick={() => toggleAvailable(item)} class="mr-2 text-xs text-indigo-600 hover:underline">
											{item.available ? 'Hide' : 'Show'}
										</button>
										<button onclick={() => archive(item)} class="text-xs text-red-600 hover:underline">Remove</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>

	<Card>
		<h2 class="mb-3 text-lg font-semibold text-gray-900">Modifier groups</h2>
		{#if groups.length === 0}
			<p class="text-sm text-gray-500">No modifier groups.</p>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2">
				{#each groups as group (group.id)}
					<div class="rounded-lg border border-gray-200 p-4">
						<div class="mb-2 flex items-center justify-between">
							<span class="font-medium text-gray-900">{group.name}</span>
							{#if group.required}
								<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Required</span>
							{/if}
						</div>
						<p class="mb-3 text-xs text-gray-500">Min {group.minSelections} · Max {group.maxSelections}</p>
						<ul class="space-y-1 text-sm text-gray-600">
							{#each group.modifiers as m}
								<li class="flex justify-between">
									<span>{m.name}</span>
									{#if m.priceAdjustment}<span class="text-gray-400">+${Number(m.priceAdjustment).toFixed(2)}</span>{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/if}
	</Card>
</div>

{#if showCreate && canWrite}
	<Modal onClose={() => (showCreate = false)}>
		<h2 class="mb-4 text-lg font-semibold text-gray-900">Add a product to the menu</h2>
		<div class="space-y-4">
			<div>
				<label for="menu-product" class="mb-1 block text-sm text-gray-600">Product</label>
				{#if productsLoading}
					<p class="text-sm text-gray-500">Loading products…</p>
				{:else if products.length === 0}
					<p class="text-sm text-gray-500">All products are already on the menu.</p>
				{:else}
					<select id="menu-product" bind:value={productId} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
						<option value="" disabled>Select a product</option>
						{#each products as p (p.id)}
							<option value={p.id}>{p.name} — ${Number(p.price).toFixed(2)}</option>
						{/each}
					</select>
				{/if}
			</div>
			<div class="flex gap-4">
				<div class="flex-1">
					<label for="menu-station" class="mb-1 block text-sm text-gray-600">Kitchen station</label>
					<input id="menu-station" bind:value={station} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
				<div class="w-28">
					<label for="menu-prep" class="mb-1 block text-sm text-gray-600">Prep (min)</label>
					<input id="menu-prep" bind:value={prepTime} type="number" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-gray-700">
				<input type="checkbox" bind:checked={visible} class="h-4 w-4" />
				Available for ordering
			</label>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={() => (showCreate = false)}>Cancel</Button>
				<Button onclick={createItem} disabled={!productId}>Add to menu</Button>
			</div>
		</div>
	</Modal>
{/if}
