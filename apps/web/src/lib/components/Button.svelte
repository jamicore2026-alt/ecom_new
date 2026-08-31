<script lang="ts">
	let { variant = 'primary', type = 'button', disabled = false, loading = false, size = 'md', class: className = '', onclick, children, ...rest } = $props<{
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
		type?: 'button' | 'submit'
		disabled?: boolean
		loading?: boolean
		size?: 'sm' | 'md'
		class?: string
		onclick?: (e: MouseEvent) => void
		children?: import('svelte').Snippet
		[key: string]: unknown
	}>()

	const classes: Record<string, string> = {
		primary:
			'bg-primary text-on-primary hover:bg-on-primary-fixed-variant focus-visible:ring-primary',
		secondary:
			'bg-white text-on-surface ring-1 ring-inset ring-outline-variant hover:bg-surface-container-low focus-visible:ring-primary',
		danger: 'bg-error text-on-error hover:bg-on-error-container focus-visible:ring-error',
		ghost: 'text-secondary hover:bg-surface-container hover:text-on-surface focus-visible:ring-primary'
	}

	const sizeClasses: Record<string, string> = {
		sm: 'px-2.5 py-2 text-xs',
		md: 'px-3.5 py-2 text-sm'
	}
</script>

<button
	{type}
	{disabled}
	{onclick}
	class="inline-flex items-center justify-center gap-1.5 rounded font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 {classes[variant]} {sizeClasses[size]} {className} disabled:cursor-not-allowed disabled:opacity-50"
>
	{#if loading}
		<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
			<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
		</svg>
	{/if}
	{@render children?.()}
</button>