<script lang="ts">
	let { title, subtitle, padded = true, class: className, children, headingLevel = 'h3' } = $props<{
		title?: string
		subtitle?: string
		padded?: boolean
		class?: string
		headingLevel?: 'h2' | 'h3' | 'h4'
		children?: import('svelte').Snippet
	}>()

	const titleTag = headingLevel
</script>

<div class="rounded-xl border border-gray-200 bg-white shadow-sm {className ?? ''}">
	{#if title}
		<div class="border-b border-gray-100 px-5 py-4">
			<svelte:element this={titleTag} class="text-base font-semibold text-gray-900">{title}</svelte:element>
			{#if subtitle}
				<p class="mt-0.5 text-xs text-gray-500">{subtitle}</p>
			{/if}
		</div>
	{/if}
	<div class={padded ? 'p-5' : ''}>
		{@render children?.()}
	</div>
</div>
