<script lang="ts">
	import { page } from '$app/state'
	import CampaignForm from '../../CampaignForm.svelte'
	import Icon from '$lib/components/Icon.svelte'
</script>

<svelte:head>
	<title>Edit campaign — Merchant OS</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<div class="mb-8 flex items-center gap-3">
		<a href="/campaigns" class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" aria-label="Back to campaigns"><Icon name="chevron_left" size="text-[20px]" /></a>
		<h1 class="font-display text-display text-on-surface">Edit campaign</h1>
	</div>
	<CampaignForm campaignId={page.params.id} onDone={() => {}} />
</div>