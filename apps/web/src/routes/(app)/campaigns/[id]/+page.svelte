<script lang="ts">
	import { page } from '$app/state'
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import { dateTime, number, titleCase } from '$lib/format'
	import type { Campaign } from '$lib/types'

	let campaign = $state<Campaign | null>(null)
	let loading = $state(true)
	let missing = $state(false)

	const canWrite = () => session.can('settings:write')

	async function load() {
		loading = true
		missing = false
		try {
			const res = await api.get<{ success: boolean; data: Campaign }>(`/api/campaigns/${page.params.id}`)
			campaign = res.data
		} catch (e) {
			if ((e as { status?: number }).status === 404) missing = true
			else toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	async function send() {
		if (!campaign || !confirm(`Send "${campaign.name}" now to all customers?`)) return
		try {
			await api.post(`/api/campaigns/${campaign.id}/send`)
			toast.success('Campaign sent')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	const openRate = $derived(campaign && campaign.sentCount > 0 ? ((campaign.openedCount / campaign.sentCount) * 100).toFixed(1) : '0.0')
	const clickRate = $derived(campaign && campaign.openedCount > 0 ? ((campaign.clickedCount / campaign.openedCount) * 100).toFixed(1) : '0.0')
</script>

<svelte:head>
	<title>{campaign ? `${campaign.name} — Merchant OS` : 'Campaign — Merchant OS'}</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<div class="grid gap-4">
			{#each Array(4) as _}
				<div class="h-24 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if missing || !campaign}
		<Card>
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="search_off" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">This campaign could not be found.</p>
				<a href="/campaigns" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">Back to campaigns</a>
			</div>
		</Card>
	{:else}
		<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
			<div class="flex items-center gap-3">
				<a href="/campaigns" class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" aria-label="Back to campaigns"><Icon name="chevron_left" size="text-[20px]" /></a>
				<div>
					<h1 class="font-display text-display text-on-surface">{campaign.name}</h1>
					<p class="mt-1 text-body-sm text-secondary">{titleCase(campaign.type)} campaign · created {dateTime(campaign.createdAt)}</p>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Badge label={campaign.status} />
				{#if canWrite()}
					{#if campaign.status === 'draft'}
						<Button size="sm" variant="secondary" onclick={send}>Send now</Button>
					{/if}
					<a href="/campaigns/{campaign.id}/edit"><Button size="sm">Edit</Button></a>
				{/if}
			</div>
		</div>

		<div class="grid grid-cols-2 gap-4 lg:grid-cols-5">
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Sent</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(campaign.sentCount)}</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Open rate</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{openRate}%</p>
				<p class="mt-0.5 text-xs text-secondary">{number(campaign.openedCount)} opens</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Click rate</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{clickRate}%</p>
				<p class="mt-0.5 text-xs text-secondary">{number(campaign.clickedCount)} clicks</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Converted</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(campaign.convertedCount)}</p>
			</div>
			<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
				<p class="text-xs text-secondary">Engagement</p>
				<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-primary">
					{campaign.sentCount > 0 ? ((campaign.openedCount + campaign.clickedCount) / campaign.sentCount * 100).toFixed(1) : '0.0'}%
				</p>
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-3">
			<Card title="Details" headingLevel="h2">
				<dl class="space-y-3 text-sm">
					<div class="flex justify-between gap-3">
						<dt class="text-secondary">Channel</dt>
						<dd class="text-on-surface">{titleCase(campaign.type)}</dd>
					</div>
					<div class="flex justify-between gap-3">
						<dt class="text-secondary">Subject</dt>
						<dd class="text-right text-on-surface">{campaign.subject ?? '—'}</dd>
					</div>
					<div class="flex justify-between gap-3">
						<dt class="text-secondary">Trigger</dt>
						<dd class="text-right text-on-surface">{campaign.triggerType ? titleCase(campaign.triggerType.replaceAll('_', ' ')) : 'Manual'}</dd>
					</div>
					<div class="flex justify-between gap-3">
						<dt class="text-secondary">Delay</dt>
						<dd class="text-on-surface">{campaign.triggerDelayHours} hrs</dd>
					</div>
					<div class="flex justify-between gap-3">
						<dt class="text-secondary">Scheduled</dt>
						<dd class="text-right text-on-surface">{campaign.scheduledAt ? dateTime(campaign.scheduledAt) : '—'}</dd>
					</div>
					<div class="flex justify-between gap-3">
						<dt class="text-secondary">Sent at</dt>
						<dd class="text-right text-on-surface">{campaign.sentAt ? dateTime(campaign.sentAt) : '—'}</dd>
					</div>
				</dl>
			</Card>

			<div class="lg:col-span-2">
				<Card title="Content" headingLevel="h2">
					{#if campaign.subject}
						<p class="mb-2 text-sm font-semibold text-on-surface">{campaign.subject}</p>
					{/if}
					{#if campaign.content}
						<div class="whitespace-pre-wrap rounded border border-outline-variant bg-surface-container-lowest p-4 text-sm leading-relaxed text-on-surface-variant">{campaign.content}</div>
					{:else}
						<p class="text-sm text-secondary">No content set for this campaign.</p>
					{/if}
				</Card>
			</div>
		</div>
	{/if}
</div>