<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Card from '$lib/components/Card.svelte'
	import Button from '$lib/components/Button.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import { number } from '$lib/format'
	import type { LoyaltyReward } from '$lib/types'

	const canWrite = () => session.can('settings:write')
	const canRead = () => session.can('customers.read')

	const TYPE_ICON: Record<string, string> = {
		product: 'local_mall',
		discount: 'sell',
		experience: 'star'
	}

	let items = $state<LoyaltyReward[]>([])
	let loading = $state(true)
	let view = $state<'grid' | 'list'>('grid')
	let statusFilter = $state('')
	let typeFilter = $state('')

	let showNew = $state(false)
	let editing = $state<LoyaltyReward | null>(null)
	let formName = $state('')
	let formDesc = $state('')
	let formType = $state('product')
	let formPoints = $state('100')
	let formStatus = $state('active')
	let formStock = $state('')

	const filtered = $derived(
		items.filter(
			(i) =>
				(!statusFilter || i.status === statusFilter) &&
				(!typeFilter || i.type === typeFilter)
		)
	)

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: LoyaltyReward[] } }>('/api/loyalty/rewards')
			items = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	function openNew() {
		editing = null
		formName = ''
		formDesc = ''
		formType = 'product'
		formPoints = '100'
		formStatus = 'active'
		formStock = ''
		showNew = true
	}

	function openEdit(reward: LoyaltyReward) {
		editing = reward
		formName = reward.name
		formDesc = reward.description ?? ''
		formType = reward.type
		formPoints = String(reward.pointsCost)
		formStatus = reward.status
		formStock = reward.stock == null ? '' : String(reward.stock)
		showNew = true
	}

	async function save() {
		if (!formName.trim()) return toast.error('Enter a reward name')
		const payload = {
			name: formName.trim(),
			description: formDesc.trim() || null,
			type: formType,
			pointsCost: Number(formPoints) || 0,
			status: formStatus,
			stock: formStock.trim() === '' ? null : Number(formStock)
		}
		try {
			if (editing) {
				await api.put<{ success: boolean }>(`/api/loyalty/rewards/${editing.id}`, payload)
				toast.success('Reward updated')
			} else {
				await api.post<{ success: boolean }>('/api/loyalty/rewards', payload)
				toast.success('Reward added')
			}
			showNew = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function remove(reward: LoyaltyReward) {
		if (!confirm(`Delete reward "${reward.name}"?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/loyalty/rewards/${reward.id}`)
			toast.success('Reward deleted')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(load)
</script>

<svelte:head>
	<title>Rewards Catalog — Merchant OS</title>
</svelte:head>

<div class="mb-6 flex flex-wrap gap-1 rounded border border-outline-variant bg-surface-container-lowest p-1">
	<a href="/loyalty" class="rounded px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">Overview</a>
	<a href="/loyalty/tiers" class="rounded px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">Tiers</a>
	<a href="/loyalty/rules" class="rounded px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">Earning rules</a>
	<a href="/loyalty/rewards" aria-current="page" class="rounded bg-surface-container px-3 py-1.5 text-sm font-medium text-on-surface">Rewards catalog</a>
</div>

{#if !canRead()}
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
		You need the <span class="font-semibold text-on-surface">customers.read</span> permission to view loyalty.
	</div>
{:else}
	<div class="space-y-6">
		<div class="mb-4 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div>
				<h1 class="font-display text-display text-on-surface">Rewards Catalog</h1>
				<p class="mt-1 text-body-sm text-secondary">Manage and configure redemption items for your loyalty members.</p>
			</div>
			{#if canWrite()}
				<Button onclick={openNew}><Icon name="add" size="text-[18px]" /> Create reward</Button>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<select class="field w-auto" bind:value={statusFilter}>
				<option value="">All statuses</option>
				<option value="active">Active</option>
				<option value="inactive">Inactive</option>
				<option value="draft">Draft</option>
			</select>
			<select class="field w-auto" bind:value={typeFilter}>
				<option value="">All types</option>
				<option value="product">Product</option>
				<option value="discount">Discount</option>
				<option value="experience">Experience</option>
			</select>
			<div class="ml-auto flex gap-1 rounded border border-outline-variant bg-surface-container-lowest p-0.5">
				<button type="button" class="rounded px-2.5 py-1.5 text-xs font-medium {view === 'grid' ? 'bg-surface-container text-on-surface' : 'text-secondary hover:text-on-surface'}" onclick={() => (view = 'grid')}><Icon name="grid_view" size="text-[16px]" /></button>
				<button type="button" class="rounded px-2.5 py-1.5 text-xs font-medium {view === 'list' ? 'bg-surface-container text-on-surface' : 'text-secondary hover:text-on-surface'}" onclick={() => (view = 'list')}><Icon name="view_list" size="text-[16px]" /></button>
			</div>
		</div>

		{#if loading}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each Array(6) as _}
					<div class="h-40 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if filtered.length === 0}
			<Card>
				<div class="py-8 text-center text-sm text-secondary">No rewards match your filters.</div>
			</Card>
		{:else if view === 'grid'}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each filtered as reward (reward.id)}
					<Card>
						<div class="flex items-start justify-between">
							<span class="flex h-10 w-10 items-center justify-center rounded bg-primary-fixed-dim/40 text-primary"><Icon name={TYPE_ICON[reward.type] ?? 'redeem'} size="text-[20px]" /></span>
							<Badge label={reward.status} />
						</div>
						<h2 class="mt-3 font-display text-lg font-semibold text-on-surface">{reward.name}</h2>
						{#if reward.description}
							<p class="mt-1 line-clamp-2 text-sm text-on-surface-variant">{reward.description}</p>
						{/if}
						<div class="mt-3 flex items-center justify-between text-sm">
							<span class="flex items-center gap-1 font-semibold text-primary"><Icon name="redeem" size="text-[16px]" /> {number(reward.pointsCost)} pts</span>
							{#if reward.stock == null}
								<span class="flex items-center gap-1 text-xs text-secondary"><Icon name="all_inclusive" size="text-[14px]" /> Unlimited</span>
							{:else}
								<span class="flex items-center gap-1 text-xs {reward.stock <= 5 ? 'text-error' : 'text-secondary'}"><Icon name="inventory_2" size="text-[14px]" /> {number(reward.stock)} in stock</span>
							{/if}
						</div>
						{#if canWrite()}
							<div class="mt-4 flex gap-2 border-t border-outline-variant pt-3">
								<Button size="sm" variant="secondary" onclick={() => openEdit(reward)}><Icon name="edit" size="text-[15px]" /> Edit</Button>
								<Button size="sm" variant="danger" onclick={() => remove(reward)}><Icon name="delete" size="text-[15px]" /> Delete</Button>
							</div>
						{/if}
					</Card>
				{/each}
			</div>
		{:else}
			<Card>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="font-table-header text-table-header uppercase tracking-wider text-secondary">
							<tr>
								<th class="pb-2 font-semibold">Reward</th>
								<th class="pb-2 font-semibold">Type</th>
								<th class="pb-2 font-semibold">Status</th>
								<th class="pb-2 font-semibold">Cost</th>
								<th class="pb-2 font-semibold">Stock</th>
								{#if canWrite()}<th class="pb-2 text-right font-semibold">Actions</th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each filtered as reward (reward.id)}
								<tr class="border-t border-outline-variant">
									<td class="py-3">
										<p class="font-medium text-on-surface">{reward.name}</p>
										{#if reward.description}<p class="text-xs text-outline">{reward.description}</p>{/if}
									</td>
									<td class="py-3 capitalize text-on-surface-variant">{reward.type}</td>
									<td class="py-3"><Badge label={reward.status} /></td>
									<td class="py-3 font-mono-label text-mono-label text-on-surface">{number(reward.pointsCost)}</td>
									<td class="py-3 text-on-surface-variant">{reward.stock == null ? 'Unlimited' : number(reward.stock)}</td>
									{#if canWrite()}
										<td class="py-3">
											<div class="flex justify-end gap-1">
												<button type="button" class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEdit(reward)}><Icon name="edit" size="text-[16px]" /></button>
												<button type="button" class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => remove(reward)}><Icon name="delete" size="text-[16px]" /></button>
											</div>
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Card>
		{/if}
	</div>
{/if}

{#if showNew && canWrite()}
	<Modal open={true} title={editing ? `Edit reward — ${editing.name}` : 'Create reward'} onClose={() => (showNew = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); save() }}>
			<div>
				<label for="w-name" class="field-label">Reward name</label>
				<input id="w-name" class="field" bind:value={formName} placeholder="e.g. Premium branded mug" />
			</div>
			<div>
				<label for="w-desc" class="field-label">Description</label>
				<textarea id="w-desc" class="field min-h-20" bind:value={formDesc} placeholder="Short description shown to members"></textarea>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="w-type" class="field-label">Type</label>
					<select id="w-type" class="field" bind:value={formType}>
						<option value="product">Product</option>
						<option value="discount">Discount</option>
						<option value="experience">Experience</option>
					</select>
				</div>
				<div>
					<label for="w-status" class="field-label">Status</label>
					<select id="w-status" class="field" bind:value={formStatus}>
						<option value="active">Active</option>
						<option value="inactive">Inactive</option>
						<option value="draft">Draft</option>
					</select>
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="w-points" class="field-label">Points cost</label>
					<input id="w-points" class="field" bind:value={formPoints} type="number" min="0" />
				</div>
				<div>
					<label for="w-stock" class="field-label">Stock (leave empty for unlimited)</label>
					<input id="w-stock" class="field" bind:value={formStock} type="number" min="0" />
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={() => (showNew = false)}>Cancel</Button>
				<Button type="submit">{editing ? 'Save' : 'Create'}</Button>
			</div>
		</form>
	</Modal>
{/if}
