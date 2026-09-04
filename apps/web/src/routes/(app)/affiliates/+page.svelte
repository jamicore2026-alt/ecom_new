<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import { dateTime, currency } from '$lib/format'

	interface Affiliate {
		id: string
		merchantId: string
		name: string
		email: string
		referralCode: string
		commissionRate: string
		status: string
		createdAt: string
	}

	interface Referral {
		id: string
		affiliateId: string
		customerId: string | null
		orderId: string | null
		conversionStatus: string
		commissionAmount: string
		commissionStatus: string
		source: string
		createdAt: string
	}

	let affiliates = $state<Affiliate[]>([])
	let referrals = $state<Referral[]>([])
	let loading = $state(true)
	let loadingReferrals = $state(false)
	let selected = $state<Affiliate | null>(null)
	let saving = $state(false)

	let showCreate = $state(false)
	let newName = $state('')
	let newEmail = $state('')
	let newCode = $state('')
	let newRate = $state(10)

	const canManage = () => session.can('staff.manage')

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Affiliate[] } }>('/api/affiliates')
			affiliates = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	async function selectAffiliate(a: Affiliate) {
		selected = a
		loadingReferrals = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Referral[] } }>(`/api/affiliates/${a.id}/referrals`)
			referrals = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
			referrals = []
		} finally {
			loadingReferrals = false
		}
	}

	async function createAffiliate() {
		if (!newName.trim()) {
			toast.error('Name is required')
			return
		}
		if (!newEmail.trim()) {
			toast.error('Email is required')
			return
		}
		if (!newCode.trim()) {
			toast.error('Referral code is required')
			return
		}
		if (newRate < 0 || newRate > 100) {
			toast.error('Commission rate must be between 0 and 100')
			return
		}
		saving = true
		try {
			const res = await api.post<{ success: boolean; data: Affiliate }>('/api/affiliates', {
				name: newName.trim(),
				email: newEmail.trim(),
				referralCode: newCode.trim().toUpperCase(),
				commissionRate: newRate
			})
			toast.success('Affiliate created')
			await load()
			selected = res.data
			await selectAffiliate(res.data)
			showCreate = false
			newName = ''
			newEmail = ''
			newCode = ''
			newRate = 10
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

</script>

<svelte:head>
	<title>Affiliates — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Affiliates</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage affiliate partners and track referrals.</p>
		</div>
		{#if canManage()}
			<Button size="sm" onclick={() => { newName = ''; newEmail = ''; newCode = ''; newRate = 10; showCreate = true }}><Icon name="add" size="text-[16px]" /> New affiliate</Button>
		{/if}
	</div>

	{#if loading}
		<div class="space-y-2 p-5">
			{#each Array(6) as _}
				<div class="h-12 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else}
		<div class="grid gap-4 lg:grid-cols-3">
			<Card padded={false} title="Affiliates" headingLevel="h2">
				<ul class="divide-y divide-outline-variant/60">
					{#each affiliates as a (a.id)}
						<li>
							<button class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors {selected?.id === a.id ? 'bg-primary-fixed-dim/20' : 'hover:bg-surface-container-low'}" onclick={() => selectAffiliate(a)}>
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-mono-label text-mono-label text-on-surface">{a.name}</span>
										<Badge label={a.status} />
									</div>
									<p class="mt-0.5 text-xs text-secondary">{a.email} · <span class="font-mono">{a.referralCode}</span> · {parseFloat(a.commissionRate)}%</p>
								</div>
								<Icon name="chevron_right" size="text-[18px]" class="text-outline" />
							</button>
						</li>
					{/each}
					{#if affiliates.length === 0}
						<li class="flex flex-col items-center gap-2 px-4 py-12 text-center">
							<Icon name="group_add" size="text-[32px]" class="text-outline" />
							<p class="text-sm text-secondary">No affiliates yet.</p>
						</li>
					{/if}
				</ul>
			</Card>

			<div class="lg:col-span-2">
				{#if !selected}
					<Card>
						<div class="flex flex-col items-center gap-3 py-16 text-center">
							<Icon name="group_add" size="text-[32px]" class="text-outline" />
							<p class="text-sm text-secondary">Select an affiliate to view their referrals.</p>
						</div>
					</Card>
				{:else}
					<Card>
						<div class="flex items-start justify-between gap-3">
							<div>
								<h2 class="font-display text-2xl text-on-surface">{selected.name}</h2>
								<p class="mt-1 text-xs text-secondary">{selected.email} · <span class="font-mono">{selected.referralCode}</span> · {parseFloat(selected.commissionRate)}% commission</p>
							</div>
							<Badge label={selected.status} />
						</div>

						<h3 class="mt-6 mb-3 text-sm font-semibold text-on-surface">Referrals</h3>

						{#if loadingReferrals}
							<div class="space-y-2">
								{#each Array(3) as _}
									<div class="h-12 animate-pulse rounded bg-surface-container"></div>
								{/each}
							</div>
						{:else if referrals.length === 0}
							<p class="py-8 text-center text-sm text-secondary">No referrals for this affiliate yet.</p>
						{:else}
							<div class="overflow-x-auto">
								<table class="w-full text-left text-sm">
									<thead>
										<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
											<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
											<th class="px-table-cell-x py-table-cell-y font-semibold">Commission</th>
											<th class="px-table-cell-x py-table-cell-y font-semibold">Order</th>
											<th class="px-table-cell-x py-table-cell-y font-semibold">Date</th>
										</tr>
									</thead>
									<tbody>
										{#each referrals as r (r.id)}
											<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
												<td class="px-table-cell-x py-table-cell-y"><Badge label={r.conversionStatus} /></td>
												<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{currency(parseFloat(r.commissionAmount))}</td>
												<td class="px-table-cell-x py-table-cell-y font-mono text-xs text-secondary">{r.orderId ?? '—'}</td>
												<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(r.createdAt)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</Card>
				{/if}
			</div>
		</div>
	{/if}
</div>

{#if showCreate}
	<Modal title="New affiliate" open={true} onClose={() => (showCreate = false)}>
		<div class="space-y-4">
			<div>
				<label class="field-label" for="aff-name">Name</label>
				<input id="aff-name" class="field" bind:value={newName} placeholder="e.g. Jane Smith" />
			</div>
			<div>
				<label class="field-label" for="aff-email">Email</label>
				<input id="aff-email" class="field" type="email" bind:value={newEmail} placeholder="jane@example.com" />
			</div>
			<div>
				<label class="field-label" for="aff-code">Referral code</label>
				<input id="aff-code" class="field font-mono" bind:value={newCode} placeholder="e.g. JANE10" />
				<p class="mt-1 text-xs text-secondary">Codes are automatically uppercased.</p>
			</div>
			<div>
				<label class="field-label" for="aff-rate">Commission rate (%)</label>
				<input id="aff-rate" class="field" type="number" min="0" max="100" step="0.5" bind:value={newRate} />
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="secondary" size="sm" onclick={() => (showCreate = false)}>Cancel</Button>
				<Button size="sm" onclick={createAffiliate} loading={saving}>Create affiliate</Button>
			</div>
		</div>
	</Modal>
{/if}
