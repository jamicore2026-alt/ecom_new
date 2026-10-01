<script lang="ts">
	import { session } from '$lib/session.svelte'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { initials } from '$lib/format'
	import { APP_MODULES, NAV_GROUP_ORDER, PINNED_ROUTES, moduleForPath, type NavItem } from '$lib/navigation'
	import { i18n, t } from '$lib/i18n'
	import { theme } from '$lib/i18n/theme.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import AppLauncher from '$lib/components/AppLauncher.svelte'
	import Sidebar from '$lib/components/Sidebar.svelte'

	let { children } = $props<{ children?: import('svelte').Snippet }>()

	let sidebarOpen = $state(false)

	let active = $derived(page.url.pathname)
	let user = $derived(session.user)
	let merchant = $derived(session.merchant)
	let navGroups = $derived.by(() => {
		const groups = session.visibleNav
		// Stable sidebar order; any unexpected group falls to the end.
		return Object.fromEntries(
			[...NAV_GROUP_ORDER, ...Object.keys(groups).filter((g) => !NAV_GROUP_ORDER.includes(g))]
				.filter((g) => groups[g]?.length)
				.map((g) => [g, groups[g]])
		)
	})

	/** Collapsed nav groups, persisted across sessions. */
	let collapsed = $state<Record<string, boolean>>({})
	if (typeof window !== 'undefined') {
		try {
			collapsed = JSON.parse(localStorage.getItem('md.navCollapsed') ?? '{}')
		} catch {
			collapsed = {}
		}
	}

	function isGroupActive(items: { route: string }[]) {
		return items.some((i) => active === i.route || active.startsWith(i.route + '/'))
	}

	// The group holding the current route always stays open; persist toggles.
	$effect(() => {
		for (const [group, items] of Object.entries(navGroups)) {
			if (isGroupActive(items) && collapsed[group]) {
				collapsed[group] = false
			}
		}
		if (typeof window !== 'undefined') {
			localStorage.setItem('md.navCollapsed', JSON.stringify(collapsed))
		}
	})

	function toggleGroup(group: string) {
		collapsed[group] = !collapsed[group]
	}

	// ---- Module app-switcher (Zoho-style pilot: Customers module) ----
	let launcherOpen = $state(false)
	/** Explicit module pin from the launcher; null = derive from the route. */
	let pinnedModuleId = $state<string | null>(null)
	/** Explicit "show everything" from the sidebar back link; sticks until the
	 *  next launcher selection (otherwise exiting on a module route would
	 *  instantly re-derive the same module). */
	let showAll = $state(false)

	const allNavItems = $derived.by((): NavItem[] => Object.values(navGroups).flat())

	/** Modules with at least one item visible to this user, in config order. */
	const launcherModules = $derived.by(() =>
		APP_MODULES.map((module) => ({
			module,
			items: module.routes.flatMap((r) => allNavItems.filter((i) => i.route === r))
		})).filter((m) => m.items.length > 0)
	)

	/** Daily-use items, always one click away above the module view. */
	const pinnedItems = $derived.by(() =>
		PINNED_ROUTES.flatMap((r) => allNavItems.filter((i) => i.route === r))
	)

	const activeModule = $derived.by(() => {
		if (showAll) return null
		if (pinnedModuleId) return APP_MODULES.find((m) => m.id === pinnedModuleId) ?? null
		return moduleForPath(active)
	})

	const activeModuleItems = $derived.by(() => {
		const mod = activeModule
		if (!mod) return []
		const items = allNavItems.filter((i) => mod.routes.includes(i.route))
		return mod.routes.flatMap((r) => items.filter((i) => i.route === r))
	})

	// Leaving a pinned module's routes clears the pin (falls back to route view).
	$effect(() => {
		if (!pinnedModuleId) return
		const mod = APP_MODULES.find((m) => m.id === pinnedModuleId)
		if (mod && !mod.routes.some((r) => active === r || active.startsWith(r + '/'))) {
			pinnedModuleId = null
		}
	})

	function selectModule(id: string | null) {
		pinnedModuleId = id
		showAll = id === null
	}

	function cycleTheme() {
		const next = theme.mode === 'light' ? 'dark' : theme.mode === 'dark' ? 'system' : 'light'
		theme.setTheme(next)
	}

	function cycleLocale() {
		i18n.setLocale(i18n.locale === 'ar' ? 'en' : 'ar')
	}

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
			<p class="text-sm text-on-surface-variant">{t('auth.tooManyRequests')}</p>
			<button
				onclick={() => session.bootstrap()}
				class="rounded bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-on-primary-fixed-variant"
			>
				{t('common.retry')}
			</button>
		{:else}
			<p class="text-sm text-on-surface-variant">{t('auth.sessionExpired')}</p>
			<a
				href="/login"
				class="rounded bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-on-primary-fixed-variant"
			>
				{t('common.signIn')}
			</a>
		{/if}
	</div>
{:else if !merchant}
	<div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-4">
		<p class="text-sm text-on-surface-variant">{t('auth.noStore')}</p>
		<a
			href="/login"
			class="rounded bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-on-primary-fixed-variant"
		>
			{t('common.signIn')}
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
				class="fixed inset-y-0 start-0 z-30 flex w-sidebar-width flex-col transform border-e border-outline-variant bg-surface transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 {sidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'}"
			>
				<!-- Brand -->
				<div class="flex h-16 shrink-0 items-center gap-3 border-b border-outline-variant px-container-padding">
					<img
						src="/logo.jpg"
						alt={merchant?.name ? `${merchant.name} logo` : 'logo'}
						class="h-10 w-10 flex-none rounded object-cover"
					/>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold tracking-tight text-on-surface">{merchant?.name}</p>
						<p class="truncate text-xs text-secondary">JamiCore</p>
					</div>
				</div>

				<Sidebar
					{navGroups}
					{collapsed}
					onToggleGroup={toggleGroup}
					{isGroupActive}
					{active}
					onNavigate={() => (sidebarOpen = false)}
					{activeModule}
					moduleItems={activeModuleItems}
					{pinnedItems}
					onExitModule={() => selectModule(null)}
				/>

				<!-- Footer: user + actions -->
				<div class="mt-auto space-y-1 border-t border-outline-variant p-3">
					<a
						href="/settings"
						onclick={() => (sidebarOpen = false)}
						class="flex items-center gap-3 rounded border-s-2 border-transparent px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container-low"
						class:bg-surface-container={active.startsWith('/settings')}
						class:text-primary={active.startsWith('/settings')}
					>
						<Icon name="settings" size="text-[18px]" />
						{t('nav.settings')}
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
							title={t('common.signOut')}
							aria-label={t('common.signOut')}
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
						<!-- App launcher -->
						<button
							class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
							onclick={() => (launcherOpen = !launcherOpen)}
							aria-label={t('nav.launcherTitle')}
							aria-expanded={launcherOpen}
							title={t('nav.launcherTitle')}
						>
							<Icon name="apps" size="text-[22px]" />
						</button>
						<span class="truncate text-headline-sm font-bold tracking-tight text-primary">{merchant.name}</span>
						{#if activeModule}
							<span class="hidden items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-on-primary sm:inline-flex">
								<Icon name={activeModule.icon} size="text-[16px]" />
								{t(activeModule.labelKey)}
							</span>
						{/if}
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
						<button
							class="flex h-11 w-11 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-container"
							onclick={cycleTheme}
							title={t('ui.theme')}
							aria-label={t('ui.theme')}
						>
							<Icon name={theme.isDark ? 'dark_mode' : 'light_mode'} size="text-[18px]" />
						</button>
						<button
							class="flex h-11 w-11 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-container"
							onclick={cycleLocale}
							title={t('ui.language')}
							aria-label={t('ui.language')}
						>
							<Icon name="translate" size="text-[18px]" />
						</button>
						<a
							href="/settings"
							class="flex h-11 w-11 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-container"
							title="{t('nav.settings')}"
							aria-label="{t('nav.settings')}"
						>
							<Icon name="settings" size="text-[18px]" />
						</a>
						<a
							href="/analytics"
							class="flex h-11 w-11 items-center justify-center rounded text-secondary transition-colors hover:bg-surface-container"
							title={t('nav.analytics')}
							aria-label={t('nav.analytics')}
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
		<AppLauncher
			open={launcherOpen}
			modules={launcherModules}
			activeModuleId={activeModule?.id ?? null}
			onClose={() => (launcherOpen = false)}
			onSelectModule={selectModule}
		/>
	</div>
{/if}