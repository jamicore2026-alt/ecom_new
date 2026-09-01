<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Card from '$lib/components/Card.svelte'
	import Button from '$lib/components/Button.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import { number, titleCase } from '$lib/format'
	import type { LoyaltyEarningRule } from '$lib/types'

	const canWrite = () => session.can('settings:write')
	const canRead = () => session.can('customers.read')

	const TRIGGER_ICON: Record<string, string> = {
		checkout: 'shopping_cart',
		birthday: 'cake',
		review: 'rate_review',
		referral: 'group_add',
		social: 'share',
		multiplier: 'trending_up',
		purchase: 'shopping_bag'
	}

	let items = $state<LoyaltyEarningRule[]>([])
	let loading = $state(true)

	let showNew = $state(false)
	let editing = $state<LoyaltyEarningRule | null>(null)
	let formName = $state('')
	let formTrigger = $state('checkout')
	let formAwardType = $state('points')
	let formAwardValue = $state('1')
	let formEnabled = $state(true)

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: LoyaltyEarningRule[] } }>('/api/loyalty/rules')
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
		formTrigger = 'checkout'
		formAwardType = 'points'
		formAwardValue = '1'
		formEnabled = true
		showNew = true
	}

	function openEdit(rule: LoyaltyEarningRule) {
		editing = rule
		formName = rule.name
		formTrigger = rule.trigger
		formAwardType = rule.awardType
		formAwardValue = String(rule.awardValue)
		formEnabled = rule.enabled
		showNew = true
	}

	function awardLabel(rule: LoyaltyEarningRule) {
		if (rule.awardType === 'percent') return `${rule.awardValue}%`
		return `${rule.awardValue} ${rule.awardType === 'points' ? 'pts' : rule.awardType}`
	}

	function triggerLabel(trigger: string) {
		return titleCase(trigger.replace(/_/g, ' '))
	}

	async function save() {
		if (!formName.trim()) return toast.error('Enter a rule name')
		const payload = {
			name: formName.trim(),
			trigger: formTrigger,
			awardType: formAwardType,
			awardValue: Number(formAwardValue) || 0,
			enabled: formEnabled
		}
		try {
			if (editing) {
				await api.put<{ success: boolean }>(`/api/loyalty/rules/${editing.id}`, payload)
				toast.success('Rule updated')
			} else {
				await api.post<{ success: boolean }>('/api/loyalty/rules', payload)
				toast.success('Rule added')
			}
			showNew = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function remove(rule: LoyaltyEarningRule) {
		if (!confirm(`Delete rule "${rule.name}"?`)) return
		try {
			await api.delete<{ success: boolean }>(`/api/loyalty/rules/${rule.id}`)
			toast.success('Rule deleted')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function toggleEnabled(rule: LoyaltyEarningRule) {
		try {
			await api.put<{ success: boolean }>(`/api/loyalty/rules/${rule.id}`, { enabled: !rule.enabled })
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	onMount(load)
</script>

<svelte:head>
	<title>Earning Rules — Merchant OS</title>
</svelte:head>

<div class="mb-6 flex flex-wrap gap-1 rounded border border-outline-variant bg-surface-container-lowest p-1">
	<a href="/loyalty" class="rounded px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">Overview</a>
	<a href="/loyalty/tiers" class="rounded px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface">Tiers</a>
	<a href="/loyalty/rules" aria-current="page" class="rounded bg-surface-container px-3 py-1.5 text-sm font-medium text-on-surface">Earning rules</a>
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
				<h1 class="font-display text-display text-on-surface">Earning Rules</h1>
				<p class="mt-1 text-body-sm text-secondary">Automation workflows for how customers earn loyalty points.</p>
			</div>
			{#if canWrite()}
				<Button onclick={openNew}><Icon name="add" size="text-[18px]" /> New rule</Button>
			{/if}
		</div>

		<div class="grid gap-4 sm:grid-cols-3">
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="trending_up" size="text-[14px]" /> Total points issued</p>
				<p class="mt-1.5 font-display text-[22px] font-semibold tracking-tight text-on-surface">{number(items.reduce((s, r) => s + r.awardValue * (r.triggerCount || 0), 0))}</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="bolt" size="text-[14px]" /> Active rules</p>
				<p class="mt-1.5 font-display text-[22px] font-semibold tracking-tight text-on-surface">
					{items.filter((r) => r.enabled).length}<span class="text-sm font-normal text-secondary"> / {items.length}</span>
				</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="local_fire_department" size="text-[14px]" /> Total triggers</p>
				<p class="mt-1.5 font-display text-[22px] font-semibold tracking-tight text-on-surface">{number(items.reduce((s, r) => s + (r.triggerCount || 0), 0))}</p>
			</div>
		</div>

		<Card>
			{#if loading}
				<div class="py-8 text-center text-sm text-secondary">Loading rules…</div>
			{:else if items.length === 0}
				<div class="py-8 text-center text-sm text-secondary">No earning rules yet. {canWrite() ? 'Create one to define how members earn points.' : ''}</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="font-table-header text-table-header uppercase tracking-wider text-secondary">
							<tr>
								<th class="pb-2 font-semibold">Status</th>
								<th class="pb-2 font-semibold">Rule</th>
								<th class="pb-2 font-semibold">Trigger</th>
								<th class="pb-2 font-semibold">Award</th>
								<th class="pb-2 font-semibold">Triggers</th>
								{#if canWrite()}<th class="pb-2 text-right font-semibold">Actions</th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each items as rule (rule.id)}
								<tr class="border-t border-outline-variant">
									<td class="py-3">
										<button type="button" class="{rule.enabled ? 'text-primary hover:text-on-primary-fixed-variant' : 'text-outline hover:text-secondary'} transition-colors" onclick={() => toggleEnabled(rule)} title="Toggle rule">
											<Icon name={rule.enabled ? 'toggle_on' : 'toggle_off'} size="text-[22px]" />
										</button>
									</td>
									<td class="py-3">
										<div class="flex items-center gap-2">
											<span class="flex h-8 w-8 items-center justify-center rounded bg-primary-fixed-dim/40 text-primary"><Icon name={TRIGGER_ICON[rule.trigger] ?? 'auto_awesome'} size="text-[16px]" /></span>
											<div>
												<p class="font-medium text-on-surface">{rule.name}</p>
												<p class="text-xs text-secondary">{triggerLabel(rule.trigger)}</p>
											</div>
										</div>
									</td>
									<td class="py-3 text-on-surface-variant">{triggerLabel(rule.trigger)}</td>
									<td class="py-3"><span class="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{awardLabel(rule)}</span></td>
									<td class="py-3 font-mono-label text-mono-label text-on-surface-variant">{number(rule.triggerCount ?? 0)}</td>
									{#if canWrite()}
										<td class="py-3">
											<div class="flex justify-end gap-1">
												<button type="button" class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => openEdit(rule)}><Icon name="edit" size="text-[16px]" /></button>
												<button type="button" class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => remove(rule)}><Icon name="delete" size="text-[16px]" /></button>
											</div>
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</Card>
	</div>
{/if}

{#if showNew && canWrite()}
	<Modal open={true} title={editing ? `Edit rule — ${editing.name}` : 'New earning rule'} onClose={() => (showNew = false)}>
		<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); save() }}>
			<div>
				<label for="r-name" class="field-label">Rule name</label>
				<input id="r-name" class="field" bind:value={formName} placeholder="e.g. Birthday bonus" />
			</div>
			<div>
				<label for="r-trigger" class="field-label">Trigger</label>
				<select id="r-trigger" class="field" bind:value={formTrigger}>
					<option value="checkout">Checkout</option>
					<option value="purchase">Purchase</option>
					<option value="birthday">Birthday</option>
					<option value="review">Product review</option>
					<option value="referral">Referral</option>
					<option value="social">Social share</option>
					<option value="multiplier">Multiplier</option>
				</select>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="r-type" class="field-label">Award type</label>
					<select id="r-type" class="field" bind:value={formAwardType}>
						<option value="points">Points (fixed)</option>
						<option value="percent">Percent multiplier</option>
					</select>
				</div>
				<div>
					<label for="r-value" class="field-label">Value</label>
					<input id="r-value" class="field" bind:value={formAwardValue} type="number" min="0" />
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-on-surface-variant">
				<input type="checkbox" class="h-4 w-4 rounded border-outline-variant text-primary" bind:checked={formEnabled} />
				Enabled
			</label>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="secondary" onclick={() => (showNew = false)}>Cancel</Button>
				<Button type="submit">{editing ? 'Save' : 'Create'}</Button>
			</div>
		</form>
	</Modal>
{/if}
