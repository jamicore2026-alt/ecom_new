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

	let id = $state(campaignId)
	let loading = $state(campaignId ? true : false)
	let saving = $state(false)

	let fName = $state('')
	let fType = $state('email')
	let fSubject = $state('')
	let fContent = $state('')
	let fTriggerType = $state('')
	let fTriggerDelayHours = $state(0)
	let fSchedule = $state('')

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
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	$effect(() => {
		if (campaignId !== id) {
			id = campaignId
			if (id) load()
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