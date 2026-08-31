<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
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

<svelte:head><title>Food Menu — Merchant OS</title></svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Food Menu</h1>
			<p class="mt-1 text-body-sm text-secondary">Restaurant items, modifiers and availability.</p>
		</div>
		{#if canWrite}
			<Button onclick={openCreate}><Icon name="add" size="text-[18px]" /> Add to menu</Button>
		{/if}
	</div>

	<Card>
		<div class="mb-4 flex items-center gap-3">
			<div class="relative min-w-[200px]">
				<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-secondary">
					<Icon name="search" size="text-[16px]" />
				</div>
				<input
					class="field pl-9"
					bind:value={search}
					oninput={() => load()}
					placeholder="Search menu items…"
				/>
			</div>
			<span class="text-sm text-secondary">{items.length} item{items.length === 1 ? '' : 's'}</span>
		</div>

		{#if loading}
			<div class="py-10 text-center text-sm text-secondary">Loading menu…</div>
		{:else if items.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="restaurant_menu" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No menu items yet.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
						<tr>
							<th class="py-2 pr-4 font-semibold">Item</th>
							<th class="py-2 pr-4 font-semibold">Price</th>
							<th class="py-2 pr-4 font-semibold">Station</th>
							<th class="py-2 pr-4 font-semibold">Prep</th>
							<th class="py-2 pr-4 font-semibold">Tags</th>
							<th class="py-2 pr-4 font-semibold">Status</th>
							<th class="py-2 text-right font-semibold">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-outline-variant/60">
						{#each items as item (item.id)}
							<tr class="transition-colors hover:bg-surface-container-low">
								<td class="py-3 pr-4">
									<div class="font-medium text-on-surface">{item.product.name}</div>
									<div class="text-xs text-outline">{item.product.sku}</div>
								</td>
								<td class="py-3 pr-4 font-mono-label text-mono-label text-on-surface">${Number(item.product.price).toFixed(2)}</td>
								<td class="py-3 pr-4 text-on-surface-variant">{item.kitchenStation ?? '—'}</td>
								<td class="py-3 pr-4 text-on-surface-variant">{item.preparationTimeMin}m</td>
								<td class="py-3 pr-4">
									<div class="flex flex-wrap gap-1">
										{#each item.dietaryTags ?? [] as t}
											<span class="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">{t}</span>
										{/each}
									</div>
								</td>
								<td class="py-3 pr-4">
									{#if item.available}
										<span class="inline-flex rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-inset ring-success">Available</span>
									{:else}
										<span class="inline-flex rounded-full bg-secondary/10 px-2 py-0.5 text-xs font-medium text-secondary ring-1 ring-inset ring-secondary">Sold out</span>
									{/if}
								</td>
								<td class="py-3 text-right">
									{#if canWrite}
										<button onclick={() => toggleAvailable(item)} class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40">
											{item.available ? 'Hide' : 'Show'}
										</button>
										<button onclick={() => archive(item)} class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40">Remove</button>
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
		<h2 class="mb-3 text-lg font-semibold text-on-surface">Modifier groups</h2>
		{#if groups.length === 0}
			<p class="text-sm text-secondary">No modifier groups.</p>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2">
				{#each groups as group (group.id)}
					<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
						<div class="mb-2 flex items-center justify-between">
							<span class="font-medium text-on-surface">{group.name}</span>
							{#if group.required}
								<span class="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning">Required</span>
							{/if}
						</div>
						<p class="mb-3 text-xs text-secondary">Min {group.minSelections} · Max {group.maxSelections}</p>
						<ul class="space-y-1 text-sm text-on-surface-variant">
							{#each group.modifiers as m}
								<li class="flex justify-between">
									<span>{m.name}</span>
									{#if m.priceAdjustment}<span class="font-mono-label text-mono-label text-on-surface-variant">+${Number(m.priceAdjustment).toFixed(2)}</span>{/if}
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
		<h2 class="mb-4 text-lg font-semibold text-on-surface">Add a product to the menu</h2>
		<div class="space-y-4">
			<div>
				<label for="menu-product" class="field-label">Product</label>
				{#if productsLoading}
					<p class="text-sm text-secondary">Loading products…</p>
				{:else if products.length === 0}
					<p class="text-sm text-secondary">All products are already on the menu.</p>
				{:else}
					<select id="menu-product" class="field" bind:value={productId}>
						<option value="" disabled>Select a product</option>
						{#each products as p (p.id)}
							<option value={p.id}>{p.name} — ${Number(p.price).toFixed(2)}</option>
						{/each}
					</select>
				{/if}
			</div>
			<div class="flex gap-4">
				<div class="flex-1">
					<label for="menu-station" class="field-label">Kitchen station</label>
					<input id="menu-station" class="field" bind:value={station} />
				</div>
				<div class="w-28">
					<label for="menu-prep" class="field-label">Prep (min)</label>
					<input id="menu-prep" class="field" bind:value={prepTime} type="number" min="0" />
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-on-surface-variant">
				<input type="checkbox" bind:checked={visible} class="field-check" />
				Available for ordering
			</label>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={() => (showCreate = false)}>Cancel</Button>
				<Button onclick={createItem} disabled={!productId}>Add to menu</Button>
			</div>
		</div>
	</Modal>
{/if}
