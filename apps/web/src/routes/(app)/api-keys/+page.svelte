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
	import { dateTime, number } from '$lib/format'
	import type { ApiKey, ApiKeyCreated, BackgroundJob, WebhookDelivery, WebhookEndpoint } from '$lib/types'

	type Tab = 'keys' | 'webhooks' | 'deliveries' | 'jobs'
	let tab = $state<Tab>('keys')

	let keys = $state<ApiKey[]>([])
	let endpoints = $state<WebhookEndpoint[]>([])
	let deliveries = $state<WebhookDelivery[]>([])
	let jobs = $state<BackgroundJob[]>([])
	let loading = $state(true)

	let showKeyModal = $state(false)
	let showEndpointModal = $state(false)
	let createdSecret = $state<string | null>(null)
	let creating = $state(false)
	let kName = $state('')

	let eName = $state('')
	let eUrl = $state('')
	let eSecret = $state('')
	let eEnabled = $state(true)
	let eEvents = $state<string[]>(['order.paid'])

	const canManage = () => session.can('settings.manage')

	const EVENT_OPTIONS = [
		'order.created', 'order.paid', 'order.cancelled', 'order.shipped', 'order.delivered',
		'refund.created', 'refund.completed', 'return.created', 'return.approved',
		'product.created', 'product.updated', 'inventory.updated', 'customer.created',
		'fulfillment.created', 'fulfillment.updated'
	]

	const deliveryTone: Record<string, string> = {
		completed: 'bg-success/10 text-success',
		failed: 'bg-error/10 text-error',
		pending: 'bg-warning/10 text-warning',
		processing: 'bg-info/10 text-info',
		skipped: 'bg-secondary/10 text-secondary'
	}

	async function load() {
		loading = true
		try {
			const [k, e, d, j] = await Promise.all([
				api.get<{ success: boolean; data: { items: ApiKey[] } }>('/api/api-keys?limit=100').catch(() => ({ data: { items: [] as ApiKey[] } })),
				api.get<{ success: boolean; data: WebhookEndpoint[] }>('/api/webhook-endpoints').catch(() => ({ data: [] as WebhookEndpoint[] })),
				api.get<{ success: boolean; data: WebhookDelivery[] }>('/api/webhook-deliveries').catch(() => ({ data: [] as WebhookDelivery[] })),
				api.get<{ success: boolean; data: BackgroundJob[] }>('/api/background-jobs').catch(() => ({ data: [] as BackgroundJob[] }))
			])
			keys = k.data.items
			endpoints = e.data
			deliveries = d.data
			jobs = j.data
		} catch (err) {
			toast.error((err as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	async function generateKey() {
		if (!kName.trim()) {
			toast.error('Key name is required')
			return
		}
		creating = true
		try {
			const res = await api.post<{ success: boolean; data: ApiKeyCreated }>('/api/api-keys', { name: kName.trim() })
			createdSecret = res.data.secret
			kName = ''
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			creating = false
		}
	}

	async function revokeKey(k: ApiKey) {
		if (!confirm(`Revoke API key "${k.name}"?`)) return
		try {
			await api.delete(`/api/api-keys/${k.id}`)
			toast.success('Key revoked')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function saveEndpoint() {
		if (!eName.trim() || !eUrl.trim()) {
			toast.error('Name and URL are required')
			return
		}
		creating = true
		try {
			await api.post('/api/webhook-endpoints', {
				name: eName.trim(),
				url: eUrl.trim(),
				secret: eSecret.trim(),
				enabled: eEnabled,
				events: eEvents
			})
			toast.success('Endpoint added')
			eName = ''
			eUrl = ''
			eSecret = ''
			eEvents = ['order.paid']
			eEnabled = true
			showEndpointModal = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			creating = false
		}
	}

	async function toggleEndpoint(ep: WebhookEndpoint) {
		try {
			await api.put(`/api/webhook-endpoints/${ep.id}`, { enabled: !ep.enabled })
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function removeEndpoint(ep: WebhookEndpoint) {
		if (!confirm(`Delete endpoint "${ep.name}"?`)) return
		try {
			await api.delete(`/api/webhook-endpoints/${ep.id}`)
			toast.success('Endpoint deleted')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function retry(d: WebhookDelivery) {
		try {
			await api.post(`/api/webhook-deliveries/${d.id}/retry`)
			toast.success('Delivery queued for retry')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}
</script>

<svelte:head>
	<title>API &amp; Webhooks — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">API &amp; Webhooks</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage authentication tokens and automated event notifications.</p>
		</div>
		<div class="flex items-center gap-2">
			{#if canManage() && tab === 'keys'}
				<Button size="sm" onclick={() => { createdSecret = null; kName = ''; showKeyModal = true }}><Icon name="add" size="text-[16px]" /> Generate API key</Button>
			{/if}
			{#if canManage() && tab === 'webhooks'}
				<Button size="sm" variant="secondary" onclick={() => (showEndpointModal = true)}><Icon name="add" size="text-[16px]" /> Add endpoint</Button>
			{/if}
		</div>
	</div>

	<div class="flex w-fit max-w-full gap-1 overflow-x-auto rounded border border-outline-variant bg-surface-container-lowest p-1">
		{#each [
			{ key: 'keys', label: 'API Keys' },
			{ key: 'webhooks', label: 'Webhooks' },
			{ key: 'deliveries', label: 'Deliveries' },
			{ key: 'jobs', label: 'Background jobs' }
		] as t (t.key)}
			<button class="rounded px-3 py-1.5 text-sm font-medium transition-colors {tab === t.key ? 'bg-primary text-on-primary' : 'text-secondary hover:bg-surface-container hover:text-on-surface'}" onclick={() => (tab = t.key as Tab)}>
				{t.label}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="grid gap-4">
			{#each Array(3) as _}
				<div class="h-20 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if tab === 'keys'}
		<Card padded={false}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Key name</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Prefix</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Scopes</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Last used</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each keys as k (k.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y font-medium text-on-surface">{k.name}</td>
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface-variant">{k.keyPrefix}</td>
								<td class="px-table-cell-x py-table-cell-y">
									<div class="flex max-w-72 flex-wrap gap-1">
										{#each k.scopes.slice(0, 3) as s (s)}<span class="rounded bg-surface-container px-1.5 py-0.5 text-xs text-on-surface-variant">{s}</span>{/each}
										{#if k.scopes.length > 3}<span class="text-xs text-secondary">+{k.scopes.length - 3}</span>{/if}
									</div>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(k.createdAt)}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{k.lastUsedAt ? dateTime(k.lastUsedAt) : '—'}</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={k.status} /></td>
								<td class="px-table-cell-x py-table-cell-y">
									{#if k.status === 'active' && canManage()}
										<div class="flex justify-end">
											<button class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => revokeKey(k)} aria-label="Revoke key"><Icon name="block" size="text-[18px]" /></button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
						{#if keys.length === 0}
							<tr><td colspan="7" class="px-5 py-10 text-center text-sm text-secondary">No API keys yet.</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		</Card>
	{:else if tab === 'webhooks'}
		<Card padded={false}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Endpoint</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Events</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Last delivery</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each endpoints as ep (ep.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y">
									<p class="font-medium text-on-surface">{ep.name}</p>
									<p class="font-mono-label text-mono-label text-secondary">{ep.url}</p>
								</td>
								<td class="px-table-cell-x py-table-cell-y">
									<div class="flex max-w-72 flex-wrap gap-1">
										{#each ep.events.slice(0, 3) as ev (ev)}<span class="rounded bg-surface-container px-1.5 py-0.5 font-mono-label text-[11px] text-on-surface-variant">{ev}</span>{/each}
										{#if ep.events.length > 3}<span class="text-xs text-secondary">+{ep.events.length - 3}</span>{/if}
									</div>
								</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{ep.lastDeliveryAt ? dateTime(ep.lastDeliveryAt) : '—'}</td>
								<td class="px-table-cell-x py-table-cell-y"><Badge label={ep.enabled ? 'active' : 'disabled'} /></td>
								<td class="px-table-cell-x py-table-cell-y">
									{#if canManage()}
										<div class="flex justify-end gap-1">
											<button class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => toggleEndpoint(ep)} aria-label="Toggle endpoint"><Icon name={ep.enabled ? 'toggle_on' : 'toggle_off'} size="text-[18px]" /></button>
											<button class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => removeEndpoint(ep)} aria-label="Delete endpoint"><Icon name="delete" size="text-[18px]" /></button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
						{#if endpoints.length === 0}
							<tr><td colspan="5" class="px-5 py-10 text-center text-sm text-secondary">No webhook endpoints configured.</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		</Card>
	{:else if tab === 'deliveries'}
		<Card padded={false}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Event</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Attempts</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Response</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Sent at</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each deliveries as d (d.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{d.event}</td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{d.attempts}</td>
								<td class="px-table-cell-x py-table-cell-y"><span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {deliveryTone[d.status] ?? 'bg-secondary/10 text-secondary ring-secondary'}">{d.status}</span></td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{d.responseCode ?? '—'}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{d.sentAt ? dateTime(d.sentAt) : '—'}</td>
								<td class="px-table-cell-x py-table-cell-y">
									{#if d.status === 'failed' && canManage()}
										<div class="flex justify-end">
											<button class="rounded p-1.5 text-secondary hover:bg-primary/10 hover:text-primary" onclick={() => retry(d)} aria-label="Retry delivery"><Icon name="refresh" size="text-[18px]" /></button>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
						{#if deliveries.length === 0}
							<tr><td colspan="6" class="px-5 py-10 text-center text-sm text-secondary">No deliveries yet.</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		</Card>
	{:else if tab === 'jobs'}
		<Card padded={false}>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-outline-variant font-table-header text-table-header uppercase tracking-wider text-secondary">
							<th class="px-table-cell-x py-table-cell-y font-semibold">Type</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Status</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Attempts</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Created</th>
							<th class="px-table-cell-x py-table-cell-y font-semibold">Completed</th>
						</tr>
					</thead>
					<tbody>
						{#each jobs as j (j.id)}
							<tr class="border-b border-outline-variant/60 transition-colors hover:bg-surface-container-low">
								<td class="px-table-cell-x py-table-cell-y font-mono-label text-mono-label text-on-surface">{j.type}</td>
								<td class="px-table-cell-x py-table-cell-y"><span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {deliveryTone[j.status] ?? 'bg-secondary/10 text-secondary ring-secondary'}">{j.status}</span></td>
								<td class="px-table-cell-x py-table-cell-y text-on-surface-variant">{j.attempts}/{j.maxAttempts}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{dateTime(j.createdAt)}</td>
								<td class="px-table-cell-x py-table-cell-y text-secondary">{j.completedAt ? dateTime(j.completedAt) : '—'}</td>
							</tr>
						{/each}
						{#if jobs.length === 0}
							<tr><td colspan="5" class="px-5 py-10 text-center text-sm text-secondary">No background jobs.</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
</div>

{#if showKeyModal}
	<Modal title="Generate API key" open={true} onClose={() => { showKeyModal = false; createdSecret = null }}>
		<div class="space-y-4">
			{#if createdSecret}
				<div class="rounded border border-success/30 bg-success/10 p-4">
					<p class="text-sm font-semibold text-on-surface">Copy your secret now</p>
					<p class="mt-1 text-xs text-secondary">This is the only time the full secret is shown. It cannot be retrieved again.</p>
					<div class="mt-3 flex items-center gap-2">
						<code class="flex-1 break-all rounded bg-surface-container px-2 py-1.5 font-mono-label text-[13px] text-on-surface">{createdSecret}</code>
						<Button size="sm" variant="secondary" onclick={() => { if (createdSecret) { navigator.clipboard.writeText(createdSecret); toast.success('Copied') } }}>Copy</Button>
					</div>
				</div>
				<Button size="sm" onclick={() => { showKeyModal = false; createdSecret = null }}>Done</Button>
			{:else}
				<div>
					<label class="field-label" for="key-name">Key name</label>
					<input id="key-name" class="field" bind:value={kName} placeholder="e.g. Production Checkout Integration" />
				</div>
				<div class="flex justify-end gap-2">
					<Button variant="secondary" size="sm" onclick={() => (showKeyModal = false)}>Cancel</Button>
					<Button size="sm" onclick={generateKey} loading={creating}>Generate</Button>
				</div>
			{/if}
		</div>
	</Modal>
{/if}

{#if showEndpointModal}
	<Modal title="Add webhook endpoint" open={true} onClose={() => (showEndpointModal = false)}>
		<div class="space-y-4">
			<div>
				<label class="field-label" for="ep-name">Endpoint name</label>
				<input id="ep-name" class="field" bind:value={eName} placeholder="e.g. Inventory Sync App" />
			</div>
			<div>
				<label class="field-label" for="ep-url">URL</label>
				<input id="ep-url" class="field" bind:value={eUrl} type="url" placeholder="https://api.example.com/webhook" />
			</div>
			<div>
				<label class="field-label" for="ep-secret">Secret (optional)</label>
				<input id="ep-secret" class="field" bind:value={eSecret} placeholder="Shared signing secret" />
			</div>
			<div>
				<p class="field-label">Subscribed events</p>
				<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
					{#each EVENT_OPTIONS as ev (ev)}
						<label class="flex items-center gap-2 text-sm text-on-surface-variant">
							<input type="checkbox" class="field-check" checked={eEvents.includes(ev)} onchange={(e) => {
								const el = e.currentTarget as HTMLInputElement
								eEvents = el.checked ? [...eEvents, ev] : eEvents.filter((x) => x !== ev)
							}} />
							<span class="font-mono-label text-[12px]">{ev}</span>
						</label>
					{/each}
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-on-surface-variant">
				<input type="checkbox" class="field-check" bind:checked={eEnabled} />
				Enabled on creation
			</label>
			<div class="flex justify-end gap-2 border-t border-outline-variant/60 pt-4">
				<Button variant="secondary" size="sm" onclick={() => (showEndpointModal = false)}>Cancel</Button>
				<Button size="sm" onclick={saveEndpoint} loading={creating}>Add endpoint</Button>
			</div>
		</div>
	</Modal>
{/if}