<script lang="ts">
	import { session } from '$lib/session.svelte'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { initials } from '$lib/format'
	import { NAV_GROUP_ICONS } from '$lib/navigation'
	import Icon from '$lib/components/Icon.svelte'

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
	<div class="flex min-h-screen items-center justify-center bg-surface">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
	</div>
{:else if !user}
	<div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4">
		{#if session.bootError === 'RATE_LIMITED'}
			<p class="text-sm text-on-surface-variant">Too many requests — please wait a few seconds and try again.</p>
			<button
				onclick={() => session.bootstrap()}
				class="rounded bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-on-primary-fixed-variant"
			>
				Retry
			</button>
		{:else}
			<p class="text-sm text-on-surface-variant">Your session has expired.</p>
			<a
				href="/login"
				class="rounded bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-on-primary-fixed-variant"
			>
				Sign in
			</a>
		{/if}
	</div>
{:else if !merchant}
	<div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4">
		<p class="text-sm text-on-surface-variant">No store is linked to this account.</p>
		<a
			href="/login"
			class="rounded bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-on-primary-fixed-variant"
		>
			Sign in
		</a>
	</div>
{:else}
	<div class="min-h-screen bg-background">
		<!-- Mobile drawer backdrop -->
		{#if sidebarOpen}
			<div class="fixed inset-0 z-20 bg-black/30 lg:hidden" onclick={() => (sidebarOpen = false)} aria-hidden="true"></div>
		{/if}

		<div class="lg:grid lg:grid-cols-[240px_1fr]">
			<!-- Sidebar -->
			<aside
				class="fixed inset-y-0 left-0 z-30 flex w-sidebar-width flex-col transform border-r border-outline-variant bg-surface transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0"
				class:translate-x-0={sidebarOpen}
				class:-translate-x-full={!sidebarOpen}
			>
				<!-- Brand -->
				<div class="flex h-16 shrink-0 items-center gap-3 border-b border-outline-variant px-container-padding">
					<div class="flex h-10 w-10 items-center justify-center rounded bg-primary-container text-on-primary-container">
						<Icon name="storefront" size="text-[20px]" />
					</div>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold tracking-tight text-on-surface">{merchant?.name}</p>
						<p class="truncate text-xs text-secondary">Merchant OS</p>
					</div>
				</div>

				<nav class="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-stack-comfortable">
					{#each Object.entries(navGroups) as [group, items]}
						<div>
							<p
								class="mb-1.5 flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-secondary"
							>
								<Icon name={NAV_GROUP_ICONS[group] ?? 'menu'} size="text-[14px]" />
								{group}
							</p>
							<div class="space-y-0.5">
								{#each items as item}
									<a
										href={item.route}
										onclick={() => (sidebarOpen = false)}
										title={item.label}
										class="flex items-center gap-3 rounded border-l-2 px-3 py-2.5 text-sm font-medium transition-colors"
										class:bg-surface-container={active === item.route || active.startsWith(item.route + '/')}
										class:text-primary={active === item.route || active.startsWith(item.route + '/')}
										class:border-primary={active === item.route || active.startsWith(item.route + '/')}
										class:border-transparent={!(active === item.route || active.startsWith(item.route + '/'))}
										class:text-secondary={!(active === item.route || active.startsWith(item.route + '/'))}
										class:hover:bg-surface-container-low={!(active === item.route || active.startsWith(item.route + '/'))}
									>
										<Icon name={item.icon} size="text-[18px]" />
										{item.label}
									</a>
								{/each}
							</div>
						</div>
					{/each}
				</nav>

				<!-- Footer: user + actions -->
				<div class="mt-auto space-y-1 border-t border-outline-variant p-3">
					<a
						href="/settings"
						onclick={() => (sidebarOpen = false)}
						class="flex items-center gap-3 rounded border-l-2 border-transparent px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container-low"
						class:bg-surface-container={active.startsWith('/settings')}
						class:text-primary={active.startsWith('/settings')}
					>
						<Icon name="settings" size="text-[18px]" />
						Settings
					</a>
					<div class="flex items-center gap-3 rounded-lg px-3 py-2">
						<div
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-surface-variant text-xs font-semibold text-on-surface"
						>
							{initials(user?.name ?? merchant.name)}
						</div>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-on-surface">{user?.name}</p>
							<p class="truncate text-xs capitalize text-secondary">{user?.role}</p>
						</div>
						<button
							class="ml-auto flex h-11 w-11 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
							onclick={handleLogout}
							title="Sign out"
							aria-label="Sign out"
						>
							<Icon name="logout" size="text-[18px]" />
						</button>
					</div>
				</div>
			</aside>

			<!-- Main -->
			<div class="flex min-w-0 flex-col">
				<!-- Top bar -->
				<header class="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-outline-variant bg-surface px-4 sm:px-container-padding">
					<div class="flex min-w-0 items-center gap-3">
						<!-- Mobile toggle -->
						<button
							class="flex h-11 w-11 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-container lg:hidden"
							onclick={() => (sidebarOpen = !sidebarOpen)}
							aria-label="Toggle navigation"
						>
							<Icon name="menu" size="text-[22px]" />
						</button>
						<span class="truncate text-headline-sm font-bold tracking-tight text-primary">{merchant.name}</span>
						{#if session.allowedOutlets.length > 0}
							<div class="hidden h-6 w-px bg-outline-variant sm:block"></div>
							{#if session.allowedOutlets.length > 1}
								<label class="hidden sm:block" for="outlet-select">
									<span class="sr-only">Outlet</span>
									<select
										id="outlet-select"
										class="rounded border border-outline-variant bg-surface-container-lowest px-3 py-1.5 text-sm text-on-surface focus:outline-2 focus:outline-primary"
										value={session.selectedOutletId ?? ''}
										onchange={(e) =>
											session.switchOutlet((e.currentTarget as HTMLSelectElement).value || null)}
									>
										<option value="">All outlets</option>
										{#each session.allowedOutlets as outlet}
											<option value={outlet.id}>{outlet.name}</option>
										{/each}
									</select>
								</label>
							{:else}
								<span class="hidden items-center gap-2 text-sm text-secondary sm:flex">
									<Icon name="location_on" size="text-[16px]" />
									{session.allowedOutlets[0].name}
								</span>
							{/if}
						{/if}
					</div>

					<div class="flex items-center gap-1.5">
						<a
							href="/settings"
							class="flex h-11 w-11 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-container"
							title="Settings"
							aria-label="Settings"
						>
							<Icon name="settings" size="text-[18px]" />
						</a>
						<a
							href="/analytics"
							class="flex h-11 w-11 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-container"
							title="Analytics"
							aria-label="Analytics"
						>
							<Icon name="insights" size="text-[18px]" />
						</a>
						<div class="mx-1 hidden h-8 w-8 items-center justify-center rounded bg-surface-variant text-xs font-semibold text-on-surface lg:flex">
							{initials(user?.name ?? merchant.name)}
						</div>
					</div>
				</header>

				<!-- Canvas -->
				<main class="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-container-padding">
					{@render children?.()}
				</main>
			</div>
		</div>
	</div>
{/if}