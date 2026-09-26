<script lang="ts">
	import { onMount } from 'svelte'
	import { page } from '$app/stores'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import { currency, dateTime } from '$lib/format'

	interface PortalData {
		affiliate: { id: string; name: string; email: string; referralCode: string; commissionRate: number; status: string }
		stats: { clicks: number; conversions: number; pending: number; approved: number; paid: number; totalEarned: number; eventsLast30Days: number }
		referrals: Array<{ id: string; conversionStatus: string; commissionAmount: number | string; commissionStatus: string; orderId: string | null; createdAt: string }>
		payouts: Array<{ id: string; commissionAmount: number | string; createdAt: string }>
	}

	let token = $state('')
	let email = $state('')
	let merchantSlug = $state('')
	let data = $state<PortalData | null>(null)
	let loading = $state(false)
	let requesting = $state(false)
	let error = $state('')

	onMount(() => {
		const t = $page.url.searchParams.get('token')
		if (t) {
			token = t
			load()
		}
	})

	async function load() {
		if (!token.trim()) return
		loading = true
		error = ''
		try {
			const res = await fetch(`/api/affiliates/portal/me?token=${encodeURIComponent(token.trim())}`)
			const body = await res.json()
			if (!res.ok) throw new Error(body?.error?.message ?? 'Invalid or expired link')
			data = body.data
		} catch (e) {
			error = (e as Error).message
			data = null
		} finally {
			loading = false
		}
	}

	async function requestLink() {
		if (!email.trim()) {
			error = 'Enter your affiliate email first'
			return
		}
		requesting = true
		error = ''
		try {
			const res = await fetch('/api/affiliates/portal/request', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: email.trim(), merchantSlug: merchantSlug.trim() || undefined })
			})
			const body = await res.json()
			if (!res.ok) throw new Error(body?.error?.message ?? 'Request failed')
			// Non-production returns the token so the flow works without a mailbox.
			if (body?.data?.token) {
				token = body.data.token
				await load()
			} else {
				error = ''
				data = null
				alert('Check your inbox for the dashboard link (valid 24h).')
			}
		} catch (e) {
			error = (e as Error).message
		} finally {
			requesting = false
		}
	}
</script>

<svelte:head><title>Affiliate Dashboard — JamiCore</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6 px-4 py-10">
	<div class="text-center">
		<h1 class="font-display text-display text-on-surface">Affiliate Dashboard</h1>
		<p class="mt-1 text-body-sm text-secondary">Sign in with your emailed magic link — no staff account needed.</p>
	</div>

	{#if !data}
		<Card>
			<div class="space-y-4">
				<div>
					<label class="field-label" for="aff-email">Affiliate email</label>
					<input id="aff-email" type="email" class="field" bind:value={email} placeholder="you@example.com" />
				</div>
				<div>
					<label class="field-label" for="aff-store">Store slug (optional)</label>
					<input id="aff-store" class="field" bind:value={merchantSlug} placeholder="jamicore-store" />
				</div>
				<div>
					<label class="field-label" for="aff-token">Or paste your link token</label>
					<input id="aff-token" class="field font-mono" bind:value={token} placeholder="token…" />
				</div>
				{#if error}<p class="text-sm text-error">{error}</p>{/if}
				<div class="flex flex-wrap gap-2">
					<Button loading={requesting} onclick={requestLink}><Icon name="mail" size="text-[16px]" /> Email me a link</Button>
					<Button variant="secondary" loading={loading} onclick={load}>Open dashboard</Button>
				</div>
			</div>
		</Card>
	{:else}
		<Card>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 class="font-display text-2xl text-on-surface">{data.affiliate.name}</h2>
					<p class="mt-1 text-xs text-secondary">Code <span class="font-mono">{data.affiliate.referralCode}</span> · {data.affiliate.commissionRate}% commission</p>
				</div>
				<Badge label={data.affiliate.status} />
			</div>
			<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded border border-outline-variant p-3"><p class="text-xs text-secondary">Clicks</p><p class="text-xl font-semibold text-on-surface">{data.stats.clicks}</p></div>
				<div class="rounded border border-outline-variant p-3"><p class="text-xs text-secondary">Conversions</p><p class="text-xl font-semibold text-on-surface">{data.stats.conversions}</p></div>
				<div class="rounded border border-outline-variant p-3"><p class="text-xs text-secondary">Pending</p><p class="text-xl font-semibold text-on-surface">{currency(data.stats.pending)}</p></div>
				<div class="rounded border border-outline-variant p-3"><p class="text-xs text-secondary">Paid out</p><p class="text-xl font-semibold text-on-surface">{currency(data.stats.paid)}</p></div>
			</div>
			<p class="mt-3 text-xs text-secondary">Total earned {currency(data.stats.totalEarned)} · approved awaiting payout {currency(data.stats.approved)} · {data.stats.eventsLast30Days} event(s) in the last 30 days.</p>
		</Card>

		<Card padded={false} title="Recent referrals">
			{#if data.referrals.length === 0}
				<p class="px-4 py-8 text-center text-sm text-secondary">No referrals yet — share your code to get started.</p>
			{:else}
				<ul class="divide-y divide-outline-variant/60">
					{#each data.referrals as r (r.id)}
						<li class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
							<div>
								<Badge label={r.conversionStatus} />
								<span class="ml-2 text-secondary">{r.orderId ? `order ${r.orderId.slice(0, 8)}…` : 'click'}</span>
							</div>
							<div class="text-right">
								<p class="font-medium text-on-surface">{currency(Number(r.commissionAmount))}</p>
								<p class="text-xs text-secondary">{r.commissionStatus} · {dateTime(r.createdAt)}</p>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<div class="text-center">
			<button class="text-sm text-secondary underline" onclick={() => { data = null; token = '' }}>Sign out</button>
		</div>
	{/if}
</div>
