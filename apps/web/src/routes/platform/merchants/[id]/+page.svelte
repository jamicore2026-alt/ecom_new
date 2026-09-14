<script lang="ts">
	import { onMount } from 'svelte'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { platformApi } from '$lib/platform-api'
	import { toast } from '$lib/toast.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Button from '$lib/components/Button.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { dateTimeFull } from '$lib/format'
	import type { PlatformMerchantDetailResponse, PlatformMerchantDetail, MerchantStatus, AuditEntry } from '$lib/types'

	let merchant: PlatformMerchantDetail | null = $state(null)
	let allowedNext: MerchantStatus[] = $state([])
	let auditItems: AuditEntry[] = $state([])
	let loading = $state(true)
	let saving = $state(false)

	let target = $state('')
	let reason = $state('')

	const id = () => page.params.id as string

	async function load() {
		loading = true
		try {
			const res = await platformApi.getMerchant(id())
			merchant = res.merchant
			allowedNext = res.allowedNextStatuses
			auditItems = res.recentAudit.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	async function submitTransition() {
		if (!target || !merchant) return
		saving = true
		try {
			await platformApi.changeStatus(merchant.id, target, reason)
			toast.success(`Status updated to ${target}`)
			target = ''
			reason = ''
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	const fmtAction = (a: string) =>
		a
			.split('.')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1).replace(/_/g, ' '))
			.join(' · ')

	const metaSummary = (e: AuditEntry) => {
		const keys = Object.keys(e.metadata ?? {})
		if (keys.length === 0) return null
		return keys.map((k) => `${k}: ${JSON.stringify((e.metadata as Record<string, unknown>)[k])}`).join(' · ')
	}
</script>

<svelte:head>
	<title>{merchant?.name ?? 'Merchant'} — JamiCore Admin</title>
</svelte:head>

<a href="/platform/merchants" class="mb-4 inline-flex items-center gap-1 text-sm font-medium text-secondary hover:text-on-surface">
	<Icon name="arrow_back" size="text-[16px]" />
	All merchants
</a>

{#if loading}
	<div class="space-y-4">
		{#each Array(4) as _}
			<div class="h-24 animate-pulse rounded border border-outline-variant bg-surface-container-lowest"></div>
		{/each}
	</div>
{:else if merchant}
	<div class="space-y-6">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-3xl font-bold tracking-tight text-on-surface">{merchant.name}</h1>
				<p class="mt-0.5 text-sm text-secondary">
					/{merchant.slug} · {merchant.email} · created {dateTimeFull(merchant.createdAt)}
				</p>
			</div>
			<Badge label={merchant.status} />
		</div>

		<div class="grid gap-6 lg:grid-cols-3">
			<div class="space-y-6 lg:col-span-1">
				<Card title="Store details">
					<dl class="space-y-3 text-sm">
						<div class="flex justify-between gap-3">
							<dt class="text-secondary">Phone</dt>
							<dd class="text-on-surface">{merchant.phone ?? '—'}</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-secondary">Currency</dt>
							<dd class="text-on-surface">{merchant.currency}</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-secondary">Timezone</dt>
							<dd class="text-on-surface">{merchant.timezone}</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-secondary">Status</dt>
							<dd class="text-on-surface">{merchant.status}</dd>
						</div>
					</dl>
				</Card>

				<Card title="Change status">
					{#if allowedNext.length === 0}
						<p class="text-sm text-secondary">No further transitions are allowed from {merchant.status}.</p>
					{:else}
						<form
							class="space-y-3"
							onsubmit={(e) => {
								e.preventDefault()
								submitTransition()
							}}
						>
							<div>
								<label class="mb-1 block text-sm font-medium text-on-surface" for="to">Move to</label>
								<select id="to" class="field w-full" bind:value={target}>
									<option value="">Choose a next status…</option>
									{#each allowedNext as s (s)}
										<option value={s}>{s}</option>
									{/each}
								</select>
							</div>
							<div>
								<label class="mb-1 block text-sm font-medium text-on-surface" for="reason">Reason (required)</label>
								<textarea
									id="reason"
									class="field min-h-24 w-full"
									bind:value={reason}
									placeholder="e.g. Payment fraud flagged by ops"
								></textarea>
							</div>
							<Button type="submit" class="w-full" variant="danger" disabled={!target || reason.trim().length < 3} loading={saving}>
								Apply transition
							</Button>
						</form>
					{/if}
					<p class="mt-3 text-xs text-secondary">Every transition is written to the audit log with the acting admin's email.</p>
				</Card>
			</div>

			<div class="lg:col-span-2">
				<Card title="Recent audit trail" padded={false} subtitle="Last 10 events for this merchant">
					{#if auditItems.length === 0}
						<div class="flex flex-col items-center gap-2 py-12 text-center">
							<Icon name="history" size="text-[28px]" class="text-outline" />
							<p class="text-sm text-secondary">No audit events yet.</p>
						</div>
					{:else}
						<div class="overflow-x-auto">
							<table class="w-full text-left text-sm">
								<thead class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
									<tr>
										<th class="px-table-cell-x py-table-cell-y font-semibold">Time</th>
										<th class="px-table-cell-x py-table-cell-y font-semibold">Actor</th>
										<th class="px-table-cell-x py-table-cell-y font-semibold">Action</th>
										<th class="px-table-cell-x py-table-cell-y font-semibold">Details</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-outline-variant/60">
									{#each auditItems as entry (entry.id)}
										<tr class="align-top transition-colors hover:bg-surface-container-low">
											<td class="whitespace-nowrap px-table-cell-x py-table-cell-y text-secondary">{dateTimeFull(entry.createdAt)}</td>
											<td class="px-table-cell-x py-table-cell-y font-medium text-on-surface">{entry.actorName ?? 'System'}</td>
											<td class="px-table-cell-x py-table-cell-y">
												<span class="inline-flex rounded-full bg-primary-fixed-dim/30 px-2.5 py-0.5 text-xs font-medium text-on-primary-fixed-variant">
													{fmtAction(entry.action)}
												</span>
											</td>
											<td class="max-w-xs px-table-cell-x py-table-cell-y">
												{#if metaSummary(entry)}
													<span class="block truncate text-xs text-on-surface-variant" title={metaSummary(entry)}>{metaSummary(entry)}</span>
												{:else}
													<span class="text-outline">—</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</Card>
			</div>
		</div>
	</div>
{/if}