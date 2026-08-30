<script lang="ts">
	import { session } from '$lib/session.svelte'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { initials } from '$lib/format'
	import { NAV_ICONS } from '$lib/navigation'

	let { children } = $props<{ children?: import('svelte').Snippet }>()

	let sidebarOpen = $state(false)

	let active = $derived(page.url.pathname)
	let user = $derived(session.user)
	let merchant = $derived(session.merchant)
	let navGroups = $derived(session.visibleNav)

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
		{#if session.bootError === 'RATE_LIMITED'}
			<p class="text-sm text-gray-500">Too many requests — please wait a few seconds and try again.</p>
			<button
				onclick={() => session.bootstrap()}
				class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
			>
				Retry
			</button>
		{:else}
			<p class="text-sm text-gray-500">Your session has expired.</p>
			<a
				href="/login"
				class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
			>
				Sign in
			</a>
		{/if}
	</div>
{:else}
	<div class="min-h-screen bg-gray-50">
		<!-- Mobile sidebar toggle -->
		<div class="sticky top-0 z-20 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
			<div class="flex items-center gap-2">
				<button class="rounded-lg p-2.5 text-gray-600 hover:bg-gray-100" onclick={() => (sidebarOpen = !sidebarOpen)} aria-label="Toggle navigation">
					<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
				<span class="text-sm font-semibold text-gray-900">{merchant?.name ?? 'Dashboard'}</span>
			</div>
			<button class="rounded-lg p-2.5 text-gray-600 hover:bg-gray-100" onclick={handleLogout} aria-label="Sign out">
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
				</svg>
			</button>
		</div>

		<div class="lg:grid lg:grid-cols-[240px_1fr]">
			<!-- Sidebar -->
			<aside
				class="fixed inset-y-0 left-0 z-30 flex w-60 flex-col transform border-r border-gray-200 bg-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0"
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

				{#if session.allowedOutlets.length > 1}
					<div class="px-3 pb-1 pt-2">
						<label for="outlet-select" class="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
							Outlet
						</label>
						<select
							id="outlet-select"
							class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
							value={session.selectedOutletId ?? ''}
							onchange={(e) => session.switchOutlet((e.currentTarget as HTMLSelectElement).value || null)}
						>
							<option value="">All outlets</option>
							{#each session.allowedOutlets as outlet}
								<option value={outlet.id}>{outlet.name}</option>
							{/each}
						</select>
					</div>
				{/if}

				<nav class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
					{#each Object.entries(navGroups) as [group, items]}
						<div>
							<p class="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-gray-400">{group}</p>
							<div class="space-y-0.5">
								{#each items as item}
									<a
										href={item.route}
										onclick={() => (sidebarOpen = false)}
										class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
										class:bg-indigo-50={active === item.route || active.startsWith(item.route + '/')}
										class:text-indigo-700={active === item.route || active.startsWith(item.route + '/')}
										class:text-gray-600={!(active === item.route || active.startsWith(item.route + '/'))}
										class:hover:bg-gray-100={!(active === item.route || active.startsWith(item.route + '/'))}
									>
										<svg
											class="h-4 w-4 shrink-0"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="1.8"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d={NAV_ICONS[item.icon]} />
										</svg>
										{item.label}
									</a>
								{/each}
							</div>
						</div>
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
						<button class="ml-auto rounded-lg p-2.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" onclick={handleLogout} title="Sign out" aria-label="Sign out">
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
