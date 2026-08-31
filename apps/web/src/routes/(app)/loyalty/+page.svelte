<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { number, titleCase } from '$lib/format'
	import type { LoyaltyOverview } from '$lib/types'

	let data = $state<LoyaltyOverview | null>(null)
	let loading = $state(true)

	const canRead = () => session.can('customers.read')

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
	<title>Loyalty &amp; Rewards — Merchant OS</title>
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
		{/if}
	</div>
{/if}