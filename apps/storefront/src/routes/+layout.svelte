<script lang="ts">
	import { onMount } from 'svelte'
	import '../app.css'
	import { initLocale } from '$lib/i18n'
	import type { LayoutProps } from './$types'

	let { children }: LayoutProps = $props()

	onMount(() => {
		initLocale()
	})
</script>

{@render children()}
