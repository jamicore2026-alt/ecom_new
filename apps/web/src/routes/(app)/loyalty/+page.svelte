<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Card from '$lib/components/Card.svelte'
	import Button from '$lib/components/Button.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { number, titleCase } from '$lib/format'
	import type { Customer, LoyaltyAccount, LoyaltyOverview, LoyaltyReward } from '$lib/types'

	let data = $state<LoyaltyOverview | null>(null)
	let loading = $state(true)

	// ---- staff redemption ----
	let query = $state('')
	let searching = $state(false)
	let results = $state<Customer[]>([])
	let selected = $state<Customer | null>(null)
	let balance = $state<LoyaltyAccount | null>(null)
	let balanceLoading = $state(false)
	let rewards = $state<LoyaltyReward[]>([])
	let rewardId = $state('')
	let redeeming = $state(false)
	let result = $state<{ code: string; rewardName: string; balance: number } | null>(null)

	const canRead = () => session.can('customers.read')
	const canRedeem = () => session.can('settings:write') || session.can('settings.manage')

	async function searchCustomers() {
		if (!query.trim()) return
		searching = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Customer[] } }>('/api/customers', {
				search: query.trim(),
				limit: '10'
			})
			results = res.data.items
			if (results.length === 0) toast.error('No customers found')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			searching = false
		}
	}

	async function selectCustomer(c: Customer) {
		selected = c
		results = []
		result = null
		balanceLoading = true
		try {
			const [acct, catalog] = await Promise.all([
				api.get<{ success: boolean; data: LoyaltyAccount }>(`/api/loyalty/${c.id}`),
				rewards.length
					? Promise.resolve(null)
					: api.get<{ success: boolean; data: { items: LoyaltyReward[] } }>('/api/loyalty/rewards')
			])
			balance = acct.data
			if (catalog) rewards = catalog.data.items.filter((r) => r.status === 'active')
			if (!rewardId && rewards.length) rewardId = rewards[0].id
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			balanceLoading = false
		}
	}

	async function redeem() {
		if (!selected || !rewardId) return
		const reward = rewards.find((r) => r.id === rewardId)
		if (reward && balance && balance.points < reward.pointsCost) {
			return toast.error(`Insufficient points — needs ${number(reward.pointsCost)}, has ${number(balance.points)}`)
		}
		redeeming = true
		try {
			const res = await api.post<{
				success: boolean
				data: { account: LoyaltyAccount; redemptionCode: string; benefit: { rewardName: string } }
			}>('/api/loyalty/redeem', { customerId: selected.id, rewardId })
			balance = res.data.account
			result = { code: res.data.redemptionCode, rewardName: res.data.benefit.rewardName, balance: res.data.account.points }
			toast.success(`Redeemed ${res.data.benefit.rewardName}`)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			redeeming = false
		}
	}

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: LoyaltyOverview }>('/api/loyalty/overview')
			data = res.data
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function barWidth(v: number, max: number) {
		return max > 0 ? `${Math.max(3, (v / max) * 100)}%` : '3%'
	}
</script>

<svelte:head>
	<title>Loyalty &amp; Rewards — JamiCore</title>
</svelte:head>

{#if !canRead()}
	<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
		You need the <span class="font-semibold text-on-surface">customers.read</span> permission to view loyalty.
	</div>
{:else}
	<div class="space-y-6">
		<div class="mb-8">
			<h1 class="font-display text-display text-on-surface">Loyalty &amp; Rewards</h1>
			<p class="mt-1 text-body-sm text-secondary">Overview of your points program across all members.</p>
		</div>

		{#if loading || !data}
			<div class="grid gap-4">
				{#each Array(4) as _}
					<div class="h-28 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="group" size="text-[14px]" /> Members</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(data.memberCount)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="account_balance_wallet" size="text-[14px]" /> Outstanding balance</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-primary">{number(data.totalPoints)}</p>
					<p class="mt-0.5 text-xs text-secondary">points on hand</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="trending_up" size="text-[14px]" /> Lifetime issued</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(data.lifetimePoints)}</p>
				</div>
				<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
					<p class="flex items-center gap-1.5 text-xs text-secondary"><Icon name="redeem" size="text-[14px]" /> Total redeemed</p>
					<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(data.totalRedeemed)}</p>
				</div>
			</div>

			<div class="grid gap-6 lg:grid-cols-2">
				<Card title="Members by tier" headingLevel="h2">
					{#if data.tiers.length === 0}
						<p class="py-10 text-center text-sm text-secondary">No loyalty members yet.</p>
					{:else}
						<div class="space-y-4">
							{#each data.tiers as t (t.tier)}
								<div>
									<div class="mb-1 flex justify-between text-sm">
										<span class="font-medium text-on-surface">{titleCase(t.tier)}</span>
										<span class="text-secondary">{number(t.count)} members</span>
									</div>
									<div class="h-2 rounded-full bg-surface-container">
										<div class="h-2 rounded-full bg-primary" style="width:{barWidth(t.count, Math.max(...data.tiers.map((x) => x.count), 1))}"></div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</Card>

				<Card>
					<div class="space-y-4">
						<div>
							<p class="text-xs uppercase tracking-wider text-secondary">Redemption rate</p>
							<p class="mt-1 font-display text-2xl text-on-surface">
								{data.lifetimePoints > 0 ? ((data.totalRedeemed / data.lifetimePoints) * 100).toFixed(1) : '0.0'}%
							</p>
						</div>
						<div class="h-2 rounded-full bg-surface-container">
							<div class="h-2 rounded-full bg-tertiary" style="width:{Math.min(100, data.lifetimePoints > 0 ? (data.totalRedeemed / data.lifetimePoints) * 100 : 0)}%"></div>
						</div>
						<div class="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest p-3 text-sm text-on-surface-variant">
							<Icon name="info" size="text-[16px]" class="text-primary" />
							Points accrue per customer automatically; adjust balances from the customer detail page.
						</div>
					</div>
				</Card>
			</div>

			<Card title="Redeem reward (staff)" headingLevel="h2">
				{#if !canRedeem()}
					<p class="py-4 text-center text-sm text-secondary">You need the <span class="font-semibold text-on-surface">settings.manage</span> permission to redeem rewards.</p>
				{:else}
					<div class="space-y-4">
						{#if !selected}
							<form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); searchCustomers() }}>
								<input class="field" bind:value={query} placeholder="Search customer by name, email or phone" aria-label="Search customer" />
								<Button type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</Button>
							</form>
							{#if results.length > 0}
								<ul class="divide-y divide-outline-variant rounded border border-outline-variant">
									{#each results as c (c.id)}
										<li>
											<button type="button" class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-container" onclick={() => selectCustomer(c)}>
												<span class="font-medium text-on-surface">{[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed'} <span class="font-normal text-secondary">· {c.email}</span></span>
												<Icon name="chevron_right" size="text-[16px]" class="text-secondary" />
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						{:else}
							<div class="flex flex-wrap items-center justify-between gap-2 rounded border border-outline-variant bg-surface-container-lowest p-3">
								<div class="text-sm">
									<p class="font-medium text-on-surface">{[selected.firstName, selected.lastName].filter(Boolean).join(' ') || 'Unnamed'}</p>
									<p class="text-xs text-secondary">{selected.email}</p>
								</div>
								<div class="flex items-center gap-3">
									<span class="flex items-center gap-1 text-sm font-semibold text-primary"><Icon name="redeem" size="text-[16px]" /> {balanceLoading ? '…' : number(balance?.points ?? 0)} pts</span>
									<button type="button" class="text-xs font-medium text-secondary hover:text-on-surface" onclick={() => { selected = null; balance = null; result = null }}>Change</button>
								</div>
							</div>

							<div class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
								<div>
									<label for="redeem-reward" class="field-label">Reward</label>
									<select id="redeem-reward" class="field" bind:value={rewardId}>
										{#each rewards as r (r.id)}
											<option value={r.id}>{r.name} — {number(r.pointsCost)} pts{r.stock != null ? ` (${number(r.stock)} left)` : ''}</option>
										{/each}
									</select>
									{#if rewards.length === 0}<p class="mt-1 text-xs text-secondary">No active rewards — create one in the rewards catalog.</p>{/if}
								</div>
								<Button onclick={redeem} disabled={redeeming || !rewardId || balanceLoading}>{redeeming ? 'Redeeming…' : 'Redeem'}</Button>
							</div>

							{#if result}
								<div class="rounded border border-primary/30 bg-primary-fixed-dim/20 p-3 text-sm">
									<p class="font-medium text-on-surface">Redeemed {result.rewardName}</p>
									<p class="mt-1 text-on-surface-variant">Redemption code: <span class="font-mono-label text-mono-label font-semibold text-primary">{result.code}</span></p>
									<p class="mt-0.5 text-xs text-secondary">New balance: {number(result.balance)} pts</p>
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</Card>
		{/if}
	</div>
{/if}