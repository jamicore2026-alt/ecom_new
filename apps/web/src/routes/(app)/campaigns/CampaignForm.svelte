<script lang="ts">
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import type { Campaign } from '$lib/types'

	let { campaignId = null, onDone } = $props<{
		campaignId?: string | null
		onDone?: (id: string) => void
	}>()

	let id = $state<string | null>(null)
	let loading = $state(false)
	let saving = $state(false)

	let fName = $state('')
	let fType = $state('email')
	let fSubject = $state('')
	let fContent = $state('')
	let fTriggerType = $state('')
	let fTriggerDelayHours = $state(0)
	let fSchedule = $state('')

	type AudienceType = 'all' | 'segment' | 'tag'
	let fAudienceType = $state<AudienceType>('all')
	let fSegmentId = $state('')
	let fTag = $state('')
	let segments = $state<{ id: string; name: string; customerCount: number }[]>([])

	async function loadSegments() {
		try {
			const res = await api.get<{ success: boolean; data: { items: typeof segments } }>('/api/segments')
			segments = res.data.items
		} catch {
			segments = []
		}
	}

	function applyAudience(audience: Record<string, unknown>) {
		const t = audience?.type
		if (t === 'segment' && typeof audience.segmentId === 'string') {
			fAudienceType = 'segment'
			fSegmentId = audience.segmentId
		} else if (t === 'tag' && typeof audience.tag === 'string') {
			fAudienceType = 'tag'
			fTag = audience.tag
		} else {
			fAudienceType = 'all'
		}
	}

	function buildAudience(): Record<string, unknown> {
		if (fAudienceType === 'segment' && fSegmentId) return { type: 'segment', segmentId: fSegmentId }
		if (fAudienceType === 'tag' && fTag.trim()) return { type: 'tag', tag: fTag.trim() }
		return { type: 'all' }
	}

	function resetForm() {
		fName = ''
		fType = 'email'
		fSubject = ''
		fContent = ''
		fTriggerType = ''
		fTriggerDelayHours = 0
		fSchedule = ''
		fAudienceType = 'all'
		fSegmentId = ''
		fTag = ''
	}

	async function load() {
		if (!id) return
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: Campaign }>(`/api/campaigns/${id}`)
			const c = res.data
			fName = c.name
			fType = c.type
			fSubject = c.subject ?? ''
			fContent = c.content ?? ''
			fTriggerType = c.triggerType ?? ''
			fTriggerDelayHours = c.triggerDelayHours
			fSchedule = c.scheduledAt ? c.scheduledAt.slice(0, 16) : ''
			applyAudience((c.audience ?? {}) as Record<string, unknown>)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	$effect(() => {
		loadSegments()
	})

	$effect(() => {
		if ((campaignId ?? null) !== id) {
			id = campaignId ?? null
			if (id) load()
			else {
				resetForm()
				loading = false
			}
		}
	})

	async function save() {
		if (!fName.trim()) {
			toast.error('Campaign name is required')
			return
		}
		saving = true
		try {
			const body: Record<string, unknown> = {
				name: fName.trim(),
				type: fType,
				subject: fSubject.trim() || null,
				content: fContent
			}
			body.triggerType = fTriggerType || null
			body.triggerDelayHours = Math.max(0, fTriggerDelayHours)
			body.scheduledAt = fSchedule ? new Date(fSchedule).toISOString() : null
			if (fAudienceType === 'segment' && !fSegmentId) {
				toast.error('Select a segment for this audience')
				saving = false
				return
			}
			if (fAudienceType === 'tag' && !fTag.trim()) {
				toast.error('Enter a tag for this audience')
				saving = false
				return
			}
			body.audience = buildAudience()

			let newId = id
			if (id) {
				await api.put(`/api/campaigns/${id}`, body)
				toast.success('Campaign updated')
			} else {
				const res = await api.post<{ success: boolean; data: Campaign }>('/api/campaigns', body)
				toast.success('Campaign created')
				newId = res.data.id
			}
			onDone?.(newId ?? '')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}
</script>

{#if loading}
	<div class="h-40 animate-pulse rounded bg-surface-container"></div>
{:else}
	<Card>
		<form class="space-y-6" onsubmit={save}>
			<div>
				<label class="field-label" for="cp-name">Campaign name</label>
				<input id="cp-name" class="field" bind:value={fName} placeholder="e.g. Summer Sale 2024" required />
			</div>

			<div>
				<p class="field-label">Delivery channel</p>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{#each [
						{ key: 'email', label: 'Email', desc: 'Rich HTML emails with tracking' },
						{ key: 'sms', label: 'SMS', desc: 'Direct text messages' },
						{ key: 'push', label: 'Push', desc: 'Reach users on device' }
					] as ch (ch.key)}
						<button type="button" class="cursor-pointer rounded border p-3 text-left transition-colors {fType === ch.key ? 'border-primary bg-primary-fixed-dim/20' : 'border-outline-variant bg-surface-container-lowest hover:bg-surface-container'}" onclick={() => (fType = ch.key)}>
							<div class="flex items-start justify-between">
								<span class="text-sm font-semibold text-on-surface">{ch.label}</span>
								<Icon name={fType === ch.key ? 'check_circle' : 'radio_button_unchecked'} size="text-[18px]" class={fType === ch.key ? 'text-primary' : 'text-outline'} />
							</div>
							<p class="mt-1 text-xs text-secondary">{ch.desc}</p>
						</button>
					{/each}
				</div>
			</div>

			<div>
				<p class="field-label">Audience</p>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{#each [
						{ key: 'all', label: 'All customers', desc: 'Every customer email' },
						{ key: 'segment', label: 'Segment', desc: 'Customers matching a segment' },
						{ key: 'tag', label: 'Tag', desc: 'Customers carrying a tag' }
					] as ch (ch.key)}
						<button type="button" class="cursor-pointer rounded border p-3 text-left transition-colors {fAudienceType === ch.key ? 'border-primary bg-primary-fixed-dim/20' : 'border-outline-variant bg-surface-container-lowest hover:bg-surface-container'}" onclick={() => (fAudienceType = ch.key as AudienceType)}>
							<div class="flex items-start justify-between">
								<span class="text-sm font-semibold text-on-surface">{ch.label}</span>
								<Icon name={fAudienceType === ch.key ? 'check_circle' : 'radio_button_unchecked'} size="text-[18px]" class={fAudienceType === ch.key ? 'text-primary' : 'text-outline'} />
							</div>
							<p class="mt-1 text-xs text-secondary">{ch.desc}</p>
						</button>
					{/each}
				</div>
				{#if fAudienceType === 'segment'}
					<div class="mt-3">
						<label class="field-label" for="cp-segment">Segment</label>
						<select id="cp-segment" class="field" bind:value={fSegmentId}>
							<option value="">Select a segment…</option>
							{#each segments as s (s.id)}
								<option value={s.id}>{s.name} ({s.customerCount})</option>
							{/each}
						</select>
						{#if segments.length === 0}
							<p class="mt-1 text-xs text-secondary">No segments yet — create one under Customers → Segments first.</p>
						{/if}
					</div>
				{/if}
				{#if fAudienceType === 'tag'}
					<div class="mt-3">
						<label class="field-label" for="cp-tag">Customer tag</label>
						<input id="cp-tag" class="field" bind:value={fTag} placeholder="e.g. vip" />
					</div>
				{/if}
			</div>

			<div>
				<label class="field-label" for="cp-subject">Subject / headline</label>
				<input id="cp-subject" class="field" bind:value={fSubject} placeholder={fType === 'sms' ? 'Text body preview' : 'Subject line'} />
			</div>

			<div>
				<label class="field-label" for="cp-content">Content</label>
				<textarea id="cp-content" class="field min-h-32" bind:value={fContent} placeholder="Write your message content…"></textarea>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<div>
					<label class="field-label" for="cp-trigger">Automation trigger (optional)</label>
					<select id="cp-trigger" class="field" bind:value={fTriggerType}>
						<option value="">None (manual)</option>
						<option value="order_placed">Order placed</option>
						<option value="abandoned_cart">Abandoned cart</option>
						<option value="new_customer">New customer</option>
					</select>
				</div>
				<div>
					<label class="field-label" for="cp-delay">Delay (hours)</label>
					<input id="cp-delay" class="field" type="number" min="0" bind:value={fTriggerDelayHours} />
				</div>
				<div>
					<label class="field-label" for="cp-schedule">Schedule at (optional)</label>
					<input id="cp-schedule" class="field" type="datetime-local" bind:value={fSchedule} />
				</div>
			</div>

			<div class="flex justify-end gap-2 border-t border-outline-variant/60 pt-4">
				<a href="/campaigns"><Button variant="secondary" type="button">Cancel</Button></a>
				<Button type="submit" loading={saving}>{saving ? 'Saving…' : id ? 'Save changes' : 'Create campaign'}</Button>
			</div>
		</form>
	</Card>
{/if}