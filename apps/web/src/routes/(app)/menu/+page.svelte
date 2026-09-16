<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import { currency } from '$lib/format'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import type { MenuItem, MenuModifier, MenuModifierGroup, MenuProductLite } from '$lib/types'

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

	let collapsed = $state<Record<string, boolean>>({})
	let groupModal = $state<null | { mode: 'create' } | { mode: 'edit'; group: MenuModifierGroup }>(null)
	let groupForm = $state({ name: '', minSelections: '1', maxSelections: '1', required: false })
	let modifierModal = $state<null | { mode: 'add'; groupId: string } | { mode: 'edit'; groupId: string; modifier: MenuModifier }>(null)
	let modifierForm = $state({ name: '', priceAdjustment: '0', available: true })
	let bindItem = $state<MenuItem | null>(null)
	let bindGroupId = $state('')

	const boundGroupIds = $derived(new Set((bindItem?.modifierGroups ?? []).map((g) => g.id)))
	const availableToBind = $derived(groups.filter((g) => !boundGroupIds.has(g.id)))

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

	onMount(load)

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

	function toggleCollapsed(id: string) {
		collapsed = { ...collapsed, [id]: !collapsed[id] }
	}

	function openCreateGroup() {
		groupModal = { mode: 'create' }
		groupForm = { name: '', minSelections: '1', maxSelections: '1', required: false }
	}

	function openEditGroup(group: MenuModifierGroup) {
		groupModal = { mode: 'edit', group }
		groupForm = {
			name: group.name,
			minSelections: String(group.minSelections),
			maxSelections: String(group.maxSelections),
			required: group.required
		}
	}

	async function saveGroup() {
		if (!groupForm.name.trim()) return toast.error('Enter a group name')
		const body = {
			name: groupForm.name.trim(),
			minSelections: Number(groupForm.minSelections) || 0,
			maxSelections: Number(groupForm.maxSelections) || 1,
			required: groupForm.required
		}
		try {
			if (groupModal?.mode === 'edit') {
				await api.put<{ success: boolean }>(`/api/modifier-groups/${groupModal.group.id}`, body)
				toast.success('Modifier group updated')
			} else {
				await api.post<{ success: boolean }>('/api/modifier-groups', body)
				toast.success('Modifier group created')
			}
			groupModal = null
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function deleteGroup(group: MenuModifierGroup) {
		if (!confirm(`Delete modifier group "${group.name}"? This also removes its modifiers.`)) return
		try {
			await api.delete<{ success: boolean; data: { id: string } }>(`/api/modifier-groups/${group.id}`)
			toast.success('Modifier group deleted')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function openAddModifier(group: MenuModifierGroup) {
		modifierModal = { mode: 'add', groupId: group.id }
		modifierForm = { name: '', priceAdjustment: '0', available: true }
	}

	function openEditModifier(group: MenuModifierGroup, modifier: MenuModifier) {
		modifierModal = { mode: 'edit', groupId: group.id, modifier }
		modifierForm = {
			name: modifier.name,
			priceAdjustment: String(modifier.priceAdjustment),
			available: modifier.available ?? true
		}
	}

	async function saveModifier() {
		if (!modifierForm.name.trim()) return toast.error('Enter a modifier name')
		const body = {
			name: modifierForm.name.trim(),
			priceAdjustment: Number(modifierForm.priceAdjustment) || 0,
			available: modifierForm.available
		}
		try {
			if (modifierModal?.mode === 'edit') {
				await api.put<{ success: boolean }>(`/api/modifiers/${modifierModal.modifier.id}`, body)
				toast.success('Modifier updated')
			} else if (modifierModal?.mode === 'add') {
				await api.post<{ success: boolean }>(`/api/modifier-groups/${modifierModal.groupId}/modifiers`, body)
				toast.success('Modifier added')
			}
			modifierModal = null
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function deleteModifier(modifier: MenuModifier) {
		if (!confirm(`Delete modifier "${modifier.name}"?`)) return
		try {
			await api.delete<{ success: boolean; data: { id: string } }>(`/api/modifiers/${modifier.id}`)
			toast.success('Modifier deleted')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function openBind(item: MenuItem) {
		bindItem = item
		bindGroupId = ''
	}

	async function bindGroup() {
		if (!bindItem || !bindGroupId) return
		try {
			const res = await api.post<{ success: boolean; data: MenuItem }>(`/api/menu/${bindItem.id}/modifiers`, { groupId: bindGroupId })
			toast.success('Modifier group added')
			items = items.map((i) => (i.id === res.data.id ? res.data : i))
			bindItem = res.data
			bindGroupId = ''
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function unbindGroup(groupId: string) {
		if (!bindItem) return
		try {
			const res = await api.delete<{ success: boolean; data: MenuItem }>(`/api/menu/${bindItem.id}/modifiers/${groupId}`)
			toast.success('Modifier group removed')
			items = items.map((i) => (i.id === res.data.id ? res.data : i))
			bindItem = res.data
		} catch (e) {
			toast.error((e as Error).message)
		}
	}
</script>

<svelte:head><title>Food Menu — JamiCore</title></svelte:head>

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
					aria-label="Search menu items"
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
								<td class="py-3 pr-4 font-mono-label text-mono-label text-on-surface">{currency(item.product.price)}</td>
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
										<button
											onclick={() => openBind(item)}
											class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40"
										>
											Modifiers ({(item.modifierGroups ?? []).length})
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
		<div class="mb-3 flex items-center justify-between gap-2">
			<h2 class="text-lg font-semibold text-on-surface">Modifier groups</h2>
			{#if canWrite}
				<Button size="sm" variant="secondary" onclick={openCreateGroup}><Icon name="add" size="text-[18px]" /> New group</Button>
			{/if}
		</div>
		{#if groups.length === 0}
			<p class="text-sm text-secondary">No modifier groups. Create one to start adding customization options.</p>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2">
				{#each groups as group (group.id)}
					<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
						<div class="mb-2 flex items-center justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2">
								<button
									class="rounded p-1 text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
									onclick={() => toggleCollapsed(group.id)}
									aria-label="Toggle modifier group"
								>
									<Icon name={collapsed[group.id] ? 'chevron_right' : 'expand_more'} size="text-[18px]" />
								</button>
								<span class="truncate font-medium text-on-surface">{group.name}</span>
								{#if group.required}
									<span class="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning">Required</span>
								{/if}
							</div>
							{#if canWrite}
								<div class="flex shrink-0 items-center gap-1">
									<button
										class="rounded p-1.5 text-primary transition-colors hover:bg-primary-fixed-dim/40"
										onclick={() => openAddModifier(group)}
										aria-label="Add modifier"
									>
										<Icon name="add" size="text-[18px]" />
									</button>
									<button
										class="rounded p-1.5 text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
										onclick={() => openEditGroup(group)}
										aria-label="Edit group"
									>
										<Icon name="edit" size="text-[18px]" />
									</button>
									<button
										class="rounded p-1.5 text-error transition-colors hover:bg-error-container/40"
										onclick={() => deleteGroup(group)}
										aria-label="Delete group"
									>
										<Icon name="delete" size="text-[18px]" />
									</button>
								</div>
							{/if}
						</div>
						{#if !collapsed[group.id]}
							<p class="mb-3 text-xs text-secondary">
								Min {group.minSelections} · Max {group.maxSelections} · {group.modifiers.length} modifier{group.modifiers.length === 1 ? '' : 's'}
							</p>
							{#if group.modifiers.length === 0}
								<p class="text-sm text-secondary">No modifiers yet.</p>
							{:else}
								<ul class="space-y-1 text-sm text-on-surface-variant">
									{#each group.modifiers as m (m.id)}
										<li class="flex items-center justify-between gap-2">
											<div class="flex min-w-0 items-center gap-2">
												<span class="truncate">{m.name}</span>
												{#if m.available}
													<span class="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">Available</span>
												{:else}
													<span class="rounded bg-secondary/10 px-1.5 py-0.5 text-xs text-secondary">Unavailable</span>
												{/if}
											</div>
											<div class="flex shrink-0 items-center gap-1">
												{#if m.priceAdjustment}
													<span class="font-mono-label text-mono-label text-on-surface-variant">{m.priceAdjustment > 0 ? '+' : ''}{currency(m.priceAdjustment)}</span>
												{/if}
												{#if canWrite}
													<button
														class="rounded p-1.5 text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
														onclick={() => openEditModifier(group, m)}
														aria-label="Edit modifier"
													>
														<Icon name="edit" size="text-[16px]" />
													</button>
													<button
														class="rounded p-1.5 text-error transition-colors hover:bg-error-container/40"
														onclick={() => deleteModifier(m)}
														aria-label="Delete modifier"
													>
														<Icon name="delete" size="text-[16px]" />
													</button>
												{/if}
											</div>
										</li>
									{/each}
								</ul>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</Card>
</div>

{#if showCreate && canWrite}
	<Modal open={true} onClose={() => (showCreate = false)}>
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
							<option value={p.id}>{p.name} — {currency(p.price)}</option>
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

{#if groupModal && canWrite}
	<Modal open={true} onClose={() => (groupModal = null)}>
		<h2 class="mb-4 text-lg font-semibold text-on-surface">{groupModal.mode === 'edit' ? 'Edit modifier group' : 'New modifier group'}</h2>
		<div class="space-y-4">
			<div>
				<label for="group-name" class="field-label">Name</label>
				<input id="group-name" class="field" bind:value={groupForm.name} placeholder="Size, Extra toppings…" />
			</div>
			<div class="flex gap-4">
				<div class="flex-1">
					<label for="group-min" class="field-label">Min selections</label>
					<input id="group-min" class="field" type="number" min="0" bind:value={groupForm.minSelections} />
				</div>
				<div class="flex-1">
					<label for="group-max" class="field-label">Max selections</label>
					<input id="group-max" class="field" type="number" min="1" bind:value={groupForm.maxSelections} />
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-on-surface-variant">
				<input type="checkbox" bind:checked={groupForm.required} class="field-check" />
				Required — customer must choose from this group
			</label>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={() => (groupModal = null)}>Cancel</Button>
				<Button onclick={saveGroup}>Save</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if modifierModal && canWrite}
	<Modal open={true} onClose={() => (modifierModal = null)}>
		<h2 class="mb-4 text-lg font-semibold text-on-surface">{modifierModal.mode === 'edit' ? 'Edit modifier' : 'Add modifier'}</h2>
		<div class="space-y-4">
			<div>
				<label for="modifier-name" class="field-label">Name</label>
				<input id="modifier-name" class="field" bind:value={modifierForm.name} placeholder="Large, Extra cheese…" />
			</div>
			<div>
				<label for="modifier-price" class="field-label">Price adjustment</label>
				<input id="modifier-price" class="field" type="number" step="0.01" bind:value={modifierForm.priceAdjustment} />
			</div>
			<label class="flex items-center gap-2 text-sm text-on-surface-variant">
				<input type="checkbox" bind:checked={modifierForm.available} class="field-check" />
				Available for selection
			</label>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={() => (modifierModal = null)}>Cancel</Button>
				<Button onclick={saveModifier}>Save</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if bindItem && canWrite}
	<Modal open={true} onClose={() => (bindItem = null)}>
		<h2 class="mb-4 text-lg font-semibold text-on-surface">Modifiers — {bindItem.product.name}</h2>
		<div class="space-y-4">
			<div class="space-y-2">
				{#if (bindItem.modifierGroups ?? []).length === 0}
					<p class="text-sm text-secondary">No modifier groups bound to this item.</p>
				{:else}
					{#each bindItem.modifierGroups ?? [] as g (g.id)}
						<div class="flex items-center justify-between gap-3 rounded border border-outline-variant bg-surface-container-lowest p-3">
							<div>
								<div class="text-sm font-medium text-on-surface">{g.name}</div>
								<div class="text-xs text-secondary">
									{g.modifiers.length} modifier{g.modifiers.length === 1 ? '' : 's'} · Min {g.minSelections} · Max {g.maxSelections}
								</div>
							</div>
							<Button size="sm" variant="danger" onclick={() => unbindGroup(g.id)}>Unbind</Button>
						</div>
					{/each}
				{/if}
			</div>
			<div class="flex items-end gap-2 border-t border-outline-variant pt-3">
				<div class="flex-1">
					<label for="bind-group" class="field-label">Add modifier group</label>
					{#if availableToBind.length === 0}
						<p class="text-sm text-secondary">All modifier groups are already bound.</p>
					{:else}
						<select id="bind-group" class="field" bind:value={bindGroupId}>
							<option value="" disabled>Select a group</option>
							{#each availableToBind as g (g.id)}
								<option value={g.id}>{g.name}</option>
							{/each}
						</select>
					{/if}
				</div>
				<Button onclick={bindGroup} disabled={!bindGroupId}>Add</Button>
			</div>
		</div>
	</Modal>
{/if}