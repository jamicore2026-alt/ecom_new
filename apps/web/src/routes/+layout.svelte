<script lang="ts">
	import '../app.css'
	import { onMount } from 'svelte'
	import { session } from '$lib/session.svelte'
	import { i18n } from '$lib/i18n'
	import { theme } from '$lib/i18n/theme.svelte'
	import Toast from '$lib/components/Toast.svelte'

	onMount(() => {
		session.bootstrap()
		i18n.initLocale()
		theme.initTheme()
	})
</script>

<Toast />
<slot />
