<script lang="ts">
	import CampaignForm from '../CampaignForm.svelte'
	import Icon from '$lib/components/Icon.svelte'
</script>

<svelte:head>
	<title>New campaign — Merchant OS</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<div class="mb-8 flex items-center gap-3">
		<a href="/campaigns" class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" aria-label="Back to campaigns"><Icon name="chevron_left" size="text-[20px]" /></a>
		<div>
			<h1 class="font-display text-display text-on-surface">Create campaign</h1>
			<p class="mt-1 text-body-sm text-secondary">Define the details of your campaign.</p>
		</div>
	</div>
	<CampaignForm onDone={(id) => { if (id) history.replaceState(null, '', `/campaigns/${id}`) }} />
</div>