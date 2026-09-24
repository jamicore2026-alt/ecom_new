<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { session } from '$lib/session.svelte'
	import { toast } from '$lib/toast.svelte'
	import { currency } from '$lib/format'
	import Button from '$lib/components/Button.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import type { MenuItem, MenuModifier, MenuModifierGroup, MenuProductLite, Category } from '$lib/types'

	const canWrite = $derived(session.can('menu.manage'))

	let items = $state<MenuItem[]>([])
	let groups = $state<MenuModifierGroup[]>([])
	let categories = $state<Category[]>([])
	let loading = $state(true)
	let search = $state('')

	let selected = $state<'all' | 'groups' | string>('all')
	let openItem = $state<string | null>(null)
	let catCollapsed = $state<Record<string, boolean>>({})
	let bindSel = $state<Record<string, string>>({})

	let showCreate = $state(false)
	let products = $state<MenuProductLite[]>([])
	let productsLoading = $state(false)
	let productId = $state('')
	let prepTime = $state('15')
	let station = $state('Grill')
	let visible = $state(true)
	let menuSortOrder = $state('0')

	let groupModal = $state<null | { mode: 'create' } | { mode: 'edit'; group: MenuModifierGroup }>(null)
	let groupForm = $state({ name: '', nameAr: '', minSelections: '1', maxSelections: '1', required: false, sortOrder: '0' })
	let modifierModal = $state<null | { mode: 'add'; groupId: string } | { mode: 'edit'; groupId: string; modifier: MenuModifier }>(null)
	let modifierForm = $state({ name: '', nameAr: '', priceAdjustment: '0', available: true, sortOrder: '0' })

	const catById = $derived(new Map(categories.map((c) => [c.id, c])))

	const catTree = $derived.by(() => {
		const byParent = new Map<string | null, Category[]>()
		for (const c of [...categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
			const key = c.parentId && catById.has(c.parentId) ? c.parentId : null
			const list = byParent.get(key) ?? []
			list.push(c)
			byParent.set(key, list)
		}
		const rows: Array<{ cat: Category; depth: number; children: number; open: boolean }> = []
		const visit = (cat: Category, depth: number) => {
			const kids = byParent.get(cat.id) ?? []
			const open = !catCollapsed[cat.id]
			rows.push({ cat, depth, children: kids.length, open })
			if (kids.length && open) for (const k of kids) visit(k, depth + 1)
		}
		for (const root of byParent.get(null) ?? []) visit(root, 0)
		return rows
	})

	const catCounts = $derived.by(() => {
		const m = new Map<string, number>()
		for (const it of items) if (it.product.categoryId) m.set(it.product.categoryId, (m.get(it.product.categoryId) ?? 0) + 1)
		return m
	})

	const filteredItems = $derived.by(() => {
		const q = search.trim().toLowerCase()
		if (!q) return items
		return items.filter(
			(i) => i.product.name.toLowerCase().includes(q) || (i.product.sku ?? '').toLowerCase().includes(q)
		)
	})

	const visibleItems = $derived.by(() => {
		const base = selected === 'all' ? filteredItems : filteredItems.filter((i) => i.product.categoryId === selected)
		return [...base].sort((a, b) => a.sortOrder - b.sortOrder)
	})

	const selectedTitle = $derived.by(() => {
		if (selected === 'groups') return 'Modifier groups'
		if (selected === 'all') return `All items (${items.length})`
		const cat = catById.get(selected)
		return cat ? `${cat.name} (${catCounts.get(selected) ?? 0})` : `Category (${catCounts.get(selected) ?? 0})`
	})

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = {}
			if (search.trim()) params.search = search.trim()
			const res = await api.get<{ success: boolean; data: { items: MenuItem[] } }>('/api/menu', params)
			items = res.data.items
			const g = await api.get<{ success: boolean; data: MenuModifierGroup[] }>('/api/modifier-groups')
			groups = g.data
			const c = await api.get<{ success: boolean; data: { items: Category[] } }>('/api/categories')
			categories = c.data.items
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
				sortOrder: Number(menuSortOrder) || 0,
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

	function select(key: string) {
		selected = key
		openItem = null
	}

	function toggleItem(id: string) {
		openItem = openItem === id ? null : id
	}

	function toggleCat(id: string) {
		catCollapsed = { ...catCollapsed, [id]: !catCollapsed[id] }
	}

	function availableToBind(item: MenuItem) {
		const bound = new Set((item.modifierGroups ?? []).map((g) => g.id))
		return groups.filter((g) => !bound.has(g.id))
	}

	async function bindGroup(item: MenuItem, groupId: string) {
		if (!groupId) return
		try {
			const res = await api.post<{ success: boolean; data: MenuItem }>(`/api/menu/${item.id}/modifiers`, { groupId })
			toast.success('Modifier group added')
			items = items.map((i) => (i.id === res.data.id ? res.data : i))
			bindSel[item.id] = ''
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function unbindGroup(item: MenuItem, groupId: string) {
		try {
			const res = await api.delete<{ success: boolean; data: MenuItem }>(`/api/menu/${item.id}/modifiers/${groupId}`)
			toast.success('Modifier group removed')
			items = items.map((i) => (i.id === res.data.id ? res.data : i))
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function openCreateGroup() {
		groupModal = { mode: 'create' }
		groupForm = { name: '', nameAr: '', minSelections: '1', maxSelections: '1', required: false, sortOrder: '0' }
	}

	function openEditGroup(group: MenuModifierGroup) {
		groupModal = { mode: 'edit', group }
		groupForm = {
			name: group.name,
			nameAr: group.nameAr ?? '',
			minSelections: String(group.minSelections),
			maxSelections: String(group.maxSelections),
			required: group.required,
			sortOrder: String(group.sortOrder ?? 0)
		}
	}

	async function saveGroup() {
		if (!groupForm.name.trim()) return toast.error('Enter a group name')
		const body = {
			name: groupForm.name.trim(),
			nameAr: groupForm.nameAr.trim() || null,
			minSelections: Number(groupForm.minSelections) || 0,
			maxSelections: Number(groupForm.maxSelections) || 1,
			required: groupForm.required,
			sortOrder: Number(groupForm.sortOrder) || 0
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
		modifierForm = { name: '', nameAr: '', priceAdjustment: '0', available: true, sortOrder: '0' }
	}

	function openEditModifier(group: MenuModifierGroup, modifier: MenuModifier) {
		modifierModal = { mode: 'edit', groupId: group.id, modifier }
		modifierForm = {
			name: modifier.name,
			nameAr: modifier.nameAr ?? '',
			priceAdjustment: String(modifier.priceAdjustment),
			available: modifier.available ?? true,
			sortOrder: String(modifier.sortOrder ?? 0)
		}
	}

	async function saveModifier() {
		if (!modifierForm.name.trim()) return toast.error('Enter a modifier name')
		const body = {
			name: modifierForm.name.trim(),
			nameAr: modifierForm.nameAr.trim() || null,
			priceAdjustment: Number(modifierForm.priceAdjustment) || 0,
			available: modifierForm.available,
			sortOrder: Number(modifierForm.sortOrder) || 0
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

	<!-- Mobile: category select -->
	<select class="field mb-4 lg:hidden" value={selected} onchange={(e) => select((e.currentTarget as HTMLSelectElement).value)}>
		<option value="all">All items ({items.length})</option>
		{#each catTree as row (row.cat.id)}
			<option value={row.cat.id}>{"•".repeat(row.depth + 1)} {row.cat.name} ({catCounts.get(row.cat.id) ?? 0})</option>
		{/each}
		<option value="groups">Modifier groups ({groups.length})</option>
	</select>

	<div class="items-start gap-6 lg:grid lg:grid-cols-[240px_1fr]">
		<!-- Nested side menu -->
		<aside class="mb-6 rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5 lg:sticky lg:top-24 lg:mb-0">
			<nav class="space-y-0.5">
				<p class="mb-1 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-widest text-secondary">
					<Icon name="restaurant_menu" size="text-[14px]" />
					Menu
				</p>

				<button
					class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium transition-colors {selected === 'all' ? 'bg-primary-fixed-dim/20 text-primary' : 'text-secondary hover:bg-surface-container-low hover:text-on-surface'}"
					onclick={() => select('all')}
				>
					<Icon name="view_list" size="text-[18px]" />
					All items
					<span class="ml-auto rounded-full bg-surface-variant px-1.5 py-0.5 text-[11px] font-medium text-on-surface-variant">{items.length}</span>
				</button>

				{#each catTree as row (row.cat.id)}
					<div
						class="flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-sm font-medium transition-colors {selected === row.cat.id ? 'bg-primary-fixed-dim/20 text-primary' : 'text-secondary hover:bg-surface-container-low hover:text-on-surface'}"
						style:padding-inline-start={`${8 + row.depth * 14}px`}
					>
						{#if row.children > 0}
							<button
								class="rounded p-0.5 text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
								onclick={() => toggleCat(row.cat.id)}
								aria-label="Toggle category"
								aria-expanded={row.open}
							>
								<Icon name={row.open ? 'expand_more' : 'chevron_right'} size="text-[18px]" />
							</button>
						{:else}
							<span class="flex h-[26px] w-[26px] items-center justify-center">
								<span class="h-1.5 w-1.5 rounded-full bg-outline"></span>
							</span>
						{/if}
						<button class="min-w-0 flex-1 truncate text-left" onclick={() => select(row.cat.id)}>
							{row.cat.name}
							<span class="ml-auto text-[11px] font-normal text-on-surface-variant">({catCounts.get(row.cat.id) ?? 0})</span>
						</button>
					</div>
				{/each}
			</nav>

			<div class="my-2 border-t border-outline-variant"></div>

			<nav class="space-y-0.5">
				<p class="mb-1 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-widest text-secondary">
					<Icon name="tune" size="text-[14px]" />
					Options
				</p>
				<button
					class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium transition-colors {selected === 'groups' ? 'bg-primary-fixed-dim/20 text-primary' : 'text-secondary hover:bg-surface-container-low hover:text-on-surface'}"
					onclick={() => select('groups')}
				>
					<Icon name="tune" size="text-[18px]" />
					Modifier groups
					<span class="ml-auto rounded-full bg-surface-variant px-1.5 py-0.5 text-[11px] font-medium text-on-surface-variant">{groups.length}</span>
				</button>
			</nav>
		</aside>

		<!-- Main panel -->
		<div class="min-w-0">
			{#if selected === 'groups'}
				<div class="mb-4 flex items-center justify-between gap-2">
					<h2 class="text-lg font-semibold text-on-surface">Modifier groups</h2>
					{#if canWrite}
						<Button size="sm" variant="secondary" onclick={openCreateGroup}><Icon name="add" size="text-[18px]" /> New group</Button>
					{/if}
				</div>

				{#if loading}
					<div class="py-10 text-center text-sm text-secondary">Loading…</div>
				{:else if groups.length === 0}
					<div class="flex flex-col items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest py-14 text-center">
						<Icon name="tune" size="text-[32px]" class="text-outline" />
						<p class="text-sm text-secondary">No modifier groups. Create one to start adding customization options.</p>
					</div>
				{:else}
					<div class="grid gap-4 sm:grid-cols-2">
						{#each groups as group (group.id)}
							<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
								<div class="mb-2 flex items-center justify-between gap-2">
									<div class="flex min-w-0 items-center gap-2">
										<span class="truncate font-medium text-on-surface">{group.name}</span>
										{#if group.nameAr}
											<span class="truncate text-sm text-secondary" dir="rtl">{group.nameAr}</span>
										{/if}
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
													{#if m.nameAr}
														<span class="truncate text-xs text-secondary" dir="rtl">{m.nameAr}</span>
													{/if}
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
							</div>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
					<div class="relative min-w-[200px] sm:min-w-[260px]">
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
					<h2 class="text-lg font-semibold text-on-surface sm:ms-1 sm:mt-0">{selectedTitle}</h2>
				</div>

				{#if loading}
					<div class="py-10 text-center text-sm text-secondary">Loading menu…</div>
				{:else if visibleItems.length === 0}
					<div class="flex flex-col items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest py-14 text-center">
						<Icon name="restaurant_menu" size="text-[32px]" class="text-outline" />
						<p class="text-sm text-secondary">
							{search.trim() ? 'No menu items match your search.' : selected === 'all' ? 'No menu items yet.' : 'No menu items in this category yet.'}
						</p>
					</div>
				{:else}
					<div class="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
						{#each visibleItems as item (item.id)}
							<div class="{openItem === item.id ? 'bg-surface-container-low' : ''} transition-colors {openItem === item.id ? '' : 'hover:bg-surface-container-low'}">
								<div class="flex items-center gap-3 px-4 py-3">
									<button
										class="flex min-w-0 flex-1 items-center gap-3 text-left"
										onclick={() => toggleItem(item.id)}
										aria-expanded={openItem === item.id}
										aria-controls={`menu-item-details-${item.id}`}
									>
										<Icon
											name={openItem === item.id ? 'expand_more' : 'chevron_right'}
											size="text-[18px]"
											class="shrink-0 text-outline transition-transform"
										/>
										<span class="min-w-0">
											<span class="block truncate font-medium text-on-surface">{item.product.name}</span>
											<span class="block truncate text-xs text-outline">{item.product.sku}</span>
										</span>
									</button>

									<span class="hidden shrink-0 font-mono-label text-mono-label text-on-surface sm:block">{currency(item.product.price)}</span>
									<span class="hidden shrink-0 text-xs text-on-surface-variant md:block">{item.kitchenStation ?? '—'}</span>
									<span class="hidden shrink-0 text-xs text-on-surface-variant lg:block">{item.preparationTimeMin}m</span>

									<div class="flex shrink-0 items-center gap-1.5">
										{#if item.available}
											<span class="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-inset ring-success">Available</span>
										{:else}
											<span class="rounded-full bg-secondary/10 px-2 py-0.5 text-xs font-medium text-secondary ring-1 ring-inset ring-secondary">Sold out</span>
										{/if}
										{#if canWrite}
											<button
												onclick={() => toggleAvailable(item)}
												class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40"
											>
												{item.available ? 'Hide' : 'Show'}
											</button>
											<button onclick={() => archive(item)} class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40">
												Remove
											</button>
										{/if}
									</div>
								</div>

								{#if openItem === item.id}
									<div id={`menu-item-details-${item.id}`} class="border-t border-outline-variant/60 bg-surface-container-low px-4 py-4">
										<div class="mb-3 flex flex-wrap items-center gap-2">
											<span class="text-[11px] font-semibold uppercase tracking-widest text-secondary">Modifier groups</span>
											<span class="hidden items-center gap-1.5 text-xs text-on-surface-variant sm:flex">
												{#each item.dietaryTags ?? [] as t}
													<span class="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">{t}</span>
												{/each}
											</span>
											<span class="ms-auto hidden text-xs text-on-surface-variant md:block">
												{currency(item.product.price)} · {item.kitchenStation ?? '—'} · {item.preparationTimeMin}m prep
											</span>
										</div>

										{#if (item.modifierGroups ?? []).length === 0}
											<p class="mb-3 text-sm text-secondary">No modifier groups bound to this item yet.</p>
										{:else}
											<ul class="mb-3 space-y-2">
												{#each item.modifierGroups ?? [] as g (g.id)}
													<li class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
														<div class="flex items-center justify-between gap-2">
															<div class="flex min-w-0 items-center gap-2">
																<span class="truncate text-sm font-medium text-on-surface">{g.name}</span>
																{#if g.nameAr}
																	<span class="truncate text-xs text-secondary" dir="rtl">{g.nameAr}</span>
																{/if}
																{#if g.required}
																	<span class="rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">Required</span>
																{/if}
																<span class="text-xs text-secondary">Min {g.minSelections} · Max {g.maxSelections}</span>
															</div>
															{#if canWrite}
																<button
																	class="rounded px-2 py-1 text-xs font-medium text-error hover:bg-error-container/40"
																	onclick={() => unbindGroup(item, g.id)}
																>
																	Unbind
																</button>
															{/if}
														</div>
														{#if g.modifiers.length > 0}
															<ul class="mt-2 space-y-1 border-s-2 border-outline-variant ps-3">
																{#each g.modifiers as m (m.id)}
																	<li class="flex items-center justify-between text-sm text-on-surface-variant">
																		<span class="flex min-w-0 items-center gap-2">
																			<span class="truncate">{m.name}</span>
																			{#if m.nameAr}
																				<span class="truncate text-xs text-secondary" dir="rtl">{m.nameAr}</span>
																			{/if}
																			{#if m.available}
																				<span class="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">Available</span>
																			{:else}
																				<span class="rounded bg-secondary/10 px-1.5 py-0.5 text-xs text-secondary">Unavailable</span>
																			{/if}
																		</span>
																		{#if m.priceAdjustment}
																			<span class="font-mono-label text-mono-label text-on-surface-variant">{m.priceAdjustment > 0 ? '+' : ''}{currency(m.priceAdjustment)}</span>
																		{/if}
																	</li>
																{/each}
															</ul>
														{/if}
													</li>
												{/each}
											</ul>
										{/if}

										{#if canWrite}
											{@const candidates = availableToBind(item)}
											<div class="flex items-end gap-2 border-t border-outline-variant/60 pt-3">
												<div class="flex-1">
													<label for={`bind-group-${item.id}`} class="field-label">Add modifier group</label>
													{#if candidates.length === 0}
														<p class="text-sm text-secondary">All modifier groups are already bound to this item.</p>
													{:else}
														<select
															id={`bind-group-${item.id}`}
															class="field"
															value={bindSel[item.id] ?? ''}
															oninput={(e) => (bindSel[item.id] = (e.currentTarget as HTMLSelectElement).value)}
														>
															<option value="" disabled>Select a group</option>
															{#each candidates as g (g.id)}
																<option value={g.id}>{g.name}</option>
															{/each}
														</select>
													{/if}
												</div>
												<Button onclick={() => bindGroup(item, bindSel[item.id] ?? '')} disabled={!bindSel[item.id]}>Add</Button>
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	</div>
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
				<div class="w-28">
					<label for="menu-sort" class="field-label">Sort order</label>
					<input id="menu-sort" class="field" bind:value={menuSortOrder} type="number" step="1" />
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
			<div>
				<label for="group-name-ar" class="field-label">Name (Arabic)</label>
				<input id="group-name-ar" class="field" dir="rtl" bind:value={groupForm.nameAr} placeholder="الحجم، إضافات…" />
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
			<div>
				<label for="group-sort" class="field-label">Sort order</label>
				<input id="group-sort" class="field" type="number" step="1" bind:value={groupForm.sortOrder} />
			</div>
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
				<label for="modifier-name-ar" class="field-label">Name (Arabic)</label>
				<input id="modifier-name-ar" class="field" dir="rtl" bind:value={modifierForm.nameAr} placeholder="كبير، جبن إضافي…" />
			</div>
			<div>
				<label for="modifier-price" class="field-label">Price adjustment</label>
				<input id="modifier-price" class="field" type="number" step="0.01" bind:value={modifierForm.priceAdjustment} />
			</div>
			<div>
				<label for="modifier-sort" class="field-label">Sort order</label>
				<input id="modifier-sort" class="field" type="number" step="1" bind:value={modifierForm.sortOrder} />
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