<script lang="ts">
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { platformApi } from '$lib/platform-api'
	import Icon from '$lib/components/Icon.svelte'

	let { children } = $props<{ children?: import('svelte').Snippet }>()

	const isLogin = () => page.url.pathname === '/platform/login'

	async function signOut() {
		await platformApi.logout()
		goto('/platform/login')
	}
</script>

<div class="min-h-screen bg-surface">
	<header class="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest/90 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
			<a href="/platform/merchants" class="flex items-center gap-2 text-on-surface">
				<span class="flex h-8 w-8 items-center justify-center rounded bg-primary-container text-on-primary-container">
					<Icon name="admin_panel_settings" size="text-[18px]" />
				</span>
				<span class="text-sm font-bold tracking-tight">JamiCore Admin</span>
			</a>
			{#if !isLogin()}
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded px-2.5 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
					onclick={signOut}
				>
					<Icon name="logout" size="text-[16px]" />
					Sign out
				</button>
			{/if}
		</div>
	</header>
	<main class="mx-auto max-w-6xl px-4 py-8">
		{@render children?.()}
	</main>
</div>