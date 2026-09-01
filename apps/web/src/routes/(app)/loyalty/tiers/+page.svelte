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
	import type { LoyaltyTier } from '$lib/types'

	const canWrite = () => session.can('settings:write')
	const canRead = () => session.can('customers.read')

	let items = $state<LoyaltyTier[]>([])
	let loading = $state(true)

	let showNew = $state(false)
	let editing = $state<LoyaltyTier | null>(null)
	let formName = $state('')
	let formMin = $state('0')
	let formStatus = $state('active')
	let formPerks = $state('')

	function perkList(tier: LoyaltyTier): string[] {
		const p = tier.perks
		if (Array.isArray(p)) return p as string[]
		if (p && typeof p === 'object') return Object.values(p).map(String)
		return []
	}

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: LoyaltyTier[] } }>('/api/loyalty/tiers')
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
		formMin = '0'
		formStatus = 'active'
		formPerks = ''
		showNew = true
	}

	function openEdit(tier: LoyaltyTier) {
		editing = tier
		formName = tier.name
		formMin = String(tier.minPoints)
		formStatus = tier.status
		formPerks = perkList(tier).join(', ')
		showNew = true
	}

	async function save() {
		if (!formName.trim()) return toast.error('Enter a tier name')
		const payload = {
			name: formName.trim(),
			minPoints: Number(formMin) || 0,
			status: formStatus,
			perks: formPerks
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		}
		try {
			if (editing) {
				await api.put<{ success: boolean }>(`/api/loyalty/tiers/${editing.id}`, payload)
				toast.success('Tier updated')
			} else {
				await api.post<{ success: boolean }>('/api/loyalty/tiers', payload)
				toast.success('Tier added')
			}
			showNew = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function remove(tier: LoyaltyTier) {
		if (!confirm(`Remove tier "${tier.name}"?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/loyalty/tiers/${tier.id}`)
			toast.success('Tier removed')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(load)
</script>

<svelte:head>
	<title>Tiers — Merchant OS</title>
</svelte:head>

<div class="mb-6 flex flex-wrap gap-1 rounded border border-outline-variant bg-surface-container-lowest p-1">
	<a href="/loyalty" class="rounded px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">Overview</a>
	<a href="/loyalty/tiers" aria-current="page" class="rounded bg-surface-container px-3 py-1.5 text-sm font-medium text-on-surface">Tiers</a>
	<a href="/loyalty/rules" class="rounded px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">Earning rules</a>
	<a href="/loyalty/rewards" class="rounded px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">Rewards catalog</a>
</div>

{#if !canRead()}
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
		You need the <span class="font-semibold text-on-surface">customers.read</span> permission to view loyalty.
	</div>
{:else}
	<div class="space-y-6">
		<div class="mb-4 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div>
				<h1 class="font-display text-display text-on-surface">Tier Management</h1>
				<p class="mt-1 text-body-sm text-secondary">Configure customer progression levels and associated benefits.</p>
			</div>
			{#if canWrite()}
				<Button onclick={openNew}><Icon name="add" size="text-[18px]" /> Add new tier</Button>
			{/if}
		</div>

		{#if loading}
			<div class="grid gap-4">
				{#each Array(3) as _}
					<div class="h-40 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<Card>
				<div class="py-8 text-center text-sm text-secondary">
					No tiers yet. {canWrite() ? 'Create your first tier to configure progression.' : ''}
				</div>
			</Card>
		{:else}
			<div class="grid gap-4 lg:grid-cols-2">
				{#each items as tier (tier.id)}
					<Card>
						<div class="flex items-start justify-between">
							<div class="flex items-center gap-3">
								<span class="flex h-10 w-10 items-center justify-center rounded-full bg-primary-fixed-dim text-lg text-primary">
									<Icon name="workspace_premium" size="text-[20px]" />
								</span>
								<div>
									<div class="flex items-center gap-2">
										<h2 class="font-display text-lg font-semibold text-on-surface">{tier.name || 'Untitled'}</h2>
										{#if tier.isDefault}<Badge label="default" />{/if}
									</div>
									<p class="text-xs text-secondary">
										From {number(tier.minPoints)} pts · {number(tier.memberCount ?? 0)} members
									</p>
								</div>
							</div>
							<Badge label={tier.status} />
						</div>

						<div class="mt-4">
							<span class="text-xs uppercase tracking-wider text-secondary">Perks ({perkList(tier).length})</span>
							<ul class="mt-2 space-y-1.5">
								{#each perkList(tier) as perk (perk)}
									<li class="flex items-center gap-2 text-sm text-on-surface-variant">
										<Icon name="check_circle" size="text-[16px]" class="text-primary" /> {perk}
									</li>
								{:else}
									<li class="text-sm text-outline">No perks configured.</li>
								{/each}
							</ul>
						</div>

						{#if canWrite()}
							<div class="mt-4 flex gap-2 border-t border-outline-variant pt-3">
								<Button size="sm" variant="secondary" onclick={() => openEdit(tier)}><Icon name="edit" size="text-[15px]" /> Edit</Button>
								<Button size="sm" variant="danger" onclick={() => remove(tier)}><Icon name="delete" size="text-[15px]" /> Delete</Button>
							</div>
						{/if}
					</Card>
				{/each}
			</div>
		{/if}
	</div>
{/if}

{#if showNew && canWrite()}
	<Modal open={true} title={editing ? `Edit tier — ${editing.name}` : 'Add new tier'} onClose={() => (showNew = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); save() }}>
			<div>
				<label for="t-name" class="field-label">Tier name</label>
				<input id="t-name" class="field" bind:value={formName} placeholder="e.g. Silver" />
			</div>
			<div>
				<label for="t-min" class="field-label">Entry points (min)</label>
				<input id="t-min" class="field" bind:value={formMin} type="number" min="0" />
			</div>
			<div>
				<label for="t-status" class="field-label">Status</label>
				<select id="t-status" class="field" bind:value={formStatus}>
					<option value="active">Active</option>
					<option value="inactive">Inactive</option>
				</select>
			</div>
			<div>
				<label for="t-perks" class="field-label">Perks (comma separated)</label>
				<input id="t-perks" class="field" bind:value={formPerks} placeholder="e.g. 1.2x earn multiplier, Free shipping" />
			</div>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={() => (showNew = false)}>Cancel</Button>
				<Button type="submit">{editing ? 'Save' : 'Create'}</Button>
			</div>
		</form>
	</Modal>
{/if}
