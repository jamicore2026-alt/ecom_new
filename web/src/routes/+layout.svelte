<script lang="ts">
	import '../app.css'
	import { onMount } from 'svelte'
	import { session } from '$lib/session.svelte'
	import Toast from '$lib/components/Toast.svelte'

	onMount(() => {
		session.bootstrap()
	})
</script>

<Toast />
<slot />
