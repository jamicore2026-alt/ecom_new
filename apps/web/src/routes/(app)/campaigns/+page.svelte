<script lang="ts">
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

	let campaigns = $state<Campaign[]>([])
	let loading = $state(true)
	let statusFilter = $state('all')

	const canWrite = () => session.can('settings:write')

	const filtered = $derived(statusFilter === 'all' ? campaigns : campaigns.filter((c) => c.status === statusFilter))

	const stats = $derived({
		total: campaigns.length,
		sent: campaigns.filter((c) => c.status === 'sent').length,
		totalReach: campaigns.reduce((s, c) => s + c.sentCount, 0),
		totalOpened: campaigns.reduce((s, c) => s + c.openedCount, 0)
	})

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: Campaign[] } }>('/api/campaigns')
			campaigns = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	async function remove(c: Campaign) {
		if (!confirm(`Delete campaign "${c.name}"?`)) return
		try {
			await api.delete(`/api/campaigns/${c.id}`)
			toast.success('Campaign deleted')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function send(c: Campaign) {
		if (!confirm(`Send campaign "${c.name}" now to all customers?`)) return
		try {
			await api.post(`/api/campaigns/${c.id}/send`)
			toast.success('Campaign sent')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}
</script>

<svelte:head>
	<title>Campaigns — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Campaigns</h1>
			<p class="mt-1 text-body-sm text-secondary">Create and manage your marketing campaigns.</p>
		</div>
		{#if canWrite()}
			<a href="/campaigns/new" class="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/90"><Icon name="add" size="text-[16px]" /> New campaign</a>
		{/if}
	</div>

	<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
		<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
			<p class="text-xs text-secondary">Total campaigns</p>
			<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(stats.total)}</p>
		</div>
		<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
			<p class="text-xs text-secondary">Sent</p>
			<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(stats.sent)}</p>
		</div>
		<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
			<p class="text-xs text-secondary">Total reach</p>
			<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{number(stats.totalReach)}</p>
		</div>
		<div class="rounded border border-outline-variant bg-surface-container-lowest p-4">
			<p class="text-xs text-secondary">Avg open rate</p>
			<p class="mt-1.5 font-display text-[24px] font-semibold tracking-tight text-on-surface">{stats.totalReach > 0 ? ((stats.totalOpened / stats.totalReach) * 100).toFixed(1) : '0.0'}%</p>
		</div>
	</div>

	<div class="flex w-fit gap-1 rounded border border-outline-variant bg-surface-container-lowest p-1">
		{#each ['all', 'draft', 'sent'] as s (s)}
			<button class="rounded px-3 py-1.5 text-sm font-medium transition-colors {statusFilter === s ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}" onclick={() => (statusFilter = s)}>
				{s[0].toUpperCase() + s.slice(1)}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="grid gap-4">
			{#each Array(3) as _}
				<div class="h-20 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if filtered.length === 0}
		<Card>
			<div class="flex flex-col items-center gap-3 py-16 text-center">
				<Icon name="campaign" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No campaigns found.</p>
			</div>
		</Card>
	{:else}
		<Card padded={false}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Campaign</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Channel</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Reach</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Opens</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Clicks</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as c (c.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<a href="/campaigns/{c.id}" class="inline-block rounded py-1 font-medium text-on-surface hover:text-primary">
										<span class="truncate">{c.name}</span>
										{#if c.subject}<span class="block text-xs font-normal text-secondary">{c.subject}</span>{/if}
									</a>
								</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={c.status} /></td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{titleCase(c.type)}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{number(c.sentCount)}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(c.openedCount)}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{number(c.clickedCount)}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(c.createdAt)}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<div class="flex items-center justify-end gap-1">
										<a href="/campaigns/{c.id}" class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" aria-label="View campaign"><Icon name="visibility" size="text-[18px]" /></a>
										{#if canWrite()}
											<a href="/campaigns/{c.id}/edit" class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" aria-label="Edit campaign"><Icon name="edit" size="text-[18px]" /></a>
											{#if c.status === 'draft'}
												<button class="rounded p-1.5 text-secondary hover:bg-primary/10 hover:text-primary" onclick={() => send(c)} aria-label="Send campaign"><Icon name="send" size="text-[18px]" /></button>
											{/if}
											<button class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => remove(c)} aria-label="Delete campaign"><Icon name="delete" size="text-[18px]" /></button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
</div>