<script lang="ts">
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { session } from '$lib/session.svelte'

	onMount(async () => {
		if (!session.ready) await session.bootstrap()
		if (session.isAuthenticated) goto('/dashboard', { replaceState: true })
		else goto('/login', { replaceState: true })
	})
</script>
