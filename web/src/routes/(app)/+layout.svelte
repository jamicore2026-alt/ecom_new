<script lang="ts">
	import { onMount } from 'svelte'
	import { session } from '$lib/session.svelte'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { initials } from '$lib/format'

	let { children } = $props<{ children?: import('svelte').Snippet }>()

	let sidebarOpen = $state(false)

	const nav = [
		{ href: '/dashboard', label: 'Overview', icon: 'grid' },
		{ href: '/products', label: 'Products', icon: 'box' },
		{ href: '/inventory', label: 'Inventory', icon: 'layers' },
		{ href: '/orders', label: 'Orders', icon: 'cart' },
		{ href: '/customers', label: 'Customers', icon: 'users' },
		{ href: '/discounts', label: 'Discounts', icon: 'tag' },
		{ href: '/analytics', label: 'Analytics', icon: 'chart' },
		{ href: '/settings', label: 'Settings', icon: 'cog' }
	]

	const icons: Record<string, string> = {
		grid: 'M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm0 6h16M9 4v16',
		box: 'M20 7l-8-4-8 4v10l8 4 8-4V7zm-8-4v10m8-6l-8 4m0 0l-8-4m8 4v8',
		layers: 'M12 2l9 5-9 5-9-5 9-5zm-9 10l9 5 9-5m-18 5l9 5 9-5',
		cart: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 4.6a1 1 0 00.9 1.4H17m-10 0a2 2 0 100 4 2 2 0 000-4zm8 0a2 2 0 100 4 2 2 0 000-4z',
		users: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87M16 3.13a4 4 0 010 7.75M12 7a4 4 0 11-8 0 4 4 0 018 0z',
		tag: 'M7 7h.01M7 3h5a2 2 0 011.42.59l7 7a2 2 0 010 2.82l-6.01 6.01a2 2 0 01-2.83 0l-7-7A2 2 0 013 11V5a2 2 0 012-2zm1 5a1 1 0 11-2 0 1 1 0 012 0z',
		chart: 'M3 3v18h18M8 17V9m5 8V5m5 12v-6',
		cog: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z'
	}

	let active = $derived(page.url.pathname)
	let user = $derived(session.user)
	let merchant = $derived(session.merchant)

	async function handleLogout() {
		await session.logout()
		goto('/login')
	}
</script>

{#if !session.ready}
	<div class="flex min-h-screen items-center justify-center bg-gray-50">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div>
	</div>
{:else if !user}
	<div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50">
		<p class="text-sm text-gray-500">Your session has expired.</p>
		<a
			href="/login"
			class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
		>
			Sign in
		</a>
	</div>
{:else}
	<div class="min-h-screen bg-gray-50">
		<!-- Mobile sidebar toggle -->
		<div class="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
			<div class="flex items-center gap-2">
				<button class="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100" onclick={() => (sidebarOpen = !sidebarOpen)} aria-label="Toggle navigation">
					<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
				<span class="text-sm font-semibold text-gray-900">{merchant?.name ?? 'Dashboard'}</span>
			</div>
			<button class="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100" onclick={handleLogout} aria-label="Sign out">
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
				</svg>
			</button>
		</div>

		<div class="lg:grid lg:grid-cols-[240px_1fr]">
			<!-- Sidebar -->
			<aside
				class="fixed inset-y-0 left-0 z-30 w-60 transform border-r border-gray-200 bg-white transition-transform lg:static lg:translate-x-0"
				class:translate-x-0={sidebarOpen}
				class:-translate-x-full={!sidebarOpen}
			>
				<div class="flex h-16 items-center gap-3 border-b border-gray-100 px-5">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
						{merchant ? initials(merchant.name) : 'S'}
					</div>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-gray-900">{merchant?.name ?? 'Store'}</p>
						<p class="truncate text-xs text-gray-500">{merchant?.currency ?? ''} {merchant?.slug ?? ''}</p>
					</div>
				</div>

				<nav class="flex-1 space-y-0.5 p-3">
					{#each nav as item}
						<a
							href={item.href}
							class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
							class:bg-indigo-50={active === item.href || active.startsWith(item.href + '/')}
							class:text-indigo-700={active === item.href || active.startsWith(item.href + '/')}
							class:text-gray-600={!(active === item.href || active.startsWith(item.href + '/'))}
							class:hover:bg-gray-100={!(active === item.href || active.startsWith(item.href + '/'))}
						>
							<svg
								class="h-4 w-4 shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="1.8"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d={icons[item.icon]} />
							</svg>
							{item.label}
						</a>
					{/each}
				</nav>

				<div class="border-t border-gray-100 p-3">
					<div class="flex items-center gap-3 rounded-lg px-3 py-2">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700"
						>
							{initials(user?.name)}
						</div>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-gray-900">{user?.name}</p>
							<p class="truncate text-xs capitalize text-gray-500">{user?.role}</p>
						</div>
						<button class="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" onclick={handleLogout} title="Sign out">
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
							</svg>
						</button>
					</div>
				</div>
			</aside>

			<!-- Main -->
			<div class="min-w-0">
				<header class="sticky top-0 z-10 hidden items-center justify-end gap-4 border-b border-gray-200 bg-white/80 px-6 py-3 backdrop-blur lg:flex">
					<div class="flex items-center gap-3">
						<span class="text-xs text-gray-500">Signed in as</span>
						<span class="text-sm font-medium text-gray-900">{user?.email}</span>
					</div>
				</header>
				<main class="p-4 sm:p-6 lg:p-8">
					{@render children?.()}
				</main>
			</div>
		</div>
	</div>
{/if}
