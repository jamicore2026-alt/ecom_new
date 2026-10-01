<script lang="ts">
	import Icon from '$lib/components/Icon.svelte'
	import { t } from '$lib/i18n'
	import { NAV_GROUP_ICONS, type AppModule, type NavItem } from '$lib/navigation'

	interface Props {
		/** Ordered legacy groups (already permission/module filtered). */
		navGroups: Record<string, NavItem[]>
		collapsed: Record<string, boolean>
		onToggleGroup: (group: string) => void
		isGroupActive: (items: NavItem[]) => boolean
		active: string
		onNavigate: () => void
		/** Module view: when set, the sidebar shows only this module's items. */
		activeModule: AppModule | null
		moduleItems: NavItem[]
		pinnedItems: NavItem[]
		onExitModule: () => void
	}

	let {
		navGroups,
		collapsed,
		onToggleGroup,
		isGroupActive,
		active,
		onNavigate,
		activeModule,
		moduleItems,
		pinnedItems,
		onExitModule
	}: Props = $props()

	const isActive = (route: string) => active === route || active.startsWith(route + '/')
</script>

<nav class="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-stack-comfortable" aria-label={t('nav.main')}>
	{#if pinnedItems.length > 0}
		<div class="space-y-0.5">
			{#each pinnedItems as item (item.route)}
				<a
					href={item.route}
					onclick={onNavigate}
					title={t(item.key ?? item.label)}
					class="flex items-center gap-3 rounded-lg border-s-2 px-3 py-2.5 ps-4 text-sm font-medium transition-colors"
					class:bg-surface-container={isActive(item.route)}
					class:text-primary={isActive(item.route)}
					class:border-primary={isActive(item.route)}
					class:border-transparent={!isActive(item.route)}
					class:text-secondary={!isActive(item.route)}
					class:hover:bg-surface-container-low={!isActive(item.route)}
				>
					<Icon name={item.icon} size="text-[20px]" />
					{t(item.key ?? item.label)}
				</a>
			{/each}
		</div>
		<div class="mx-3 border-t border-outline-variant/60" aria-hidden="true"></div>
	{/if}

	{#if activeModule}
		<div class="overflow-hidden rounded-xl bg-surface-container-low">
			<div class="flex items-center gap-2.5 px-3 py-2.5">
				<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary">
					<Icon name={activeModule.icon} size="text-[18px]" />
				</span>
				<span class="flex-1 text-start text-[13px] font-bold uppercase tracking-wider text-primary">{t(activeModule.labelKey)}</span>
				<button
					onclick={onExitModule}
					class="rounded-lg px-2 py-1 text-xs font-medium text-secondary transition-colors hover:bg-surface-container hover:text-on-surface"
				>
					{t('nav.allItems')}
				</button>
			</div>
			<div class="space-y-0.5 px-1 pb-2">
				{#each moduleItems as item (item.route)}
					<a
						href={item.route}
						onclick={onNavigate}
						title={t(item.key ?? item.label)}
						class="flex items-center gap-3 rounded-lg border-s-2 px-3 py-2.5 ps-4 text-sm font-medium transition-colors"
						class:bg-surface-container={isActive(item.route)}
						class:text-primary={isActive(item.route)}
						class:border-primary={isActive(item.route)}
						class:border-transparent={!isActive(item.route)}
						class:text-secondary={!isActive(item.route)}
						class:hover:bg-surface-container-low={!isActive(item.route)}
					>
						<Icon name={item.icon} size="text-[20px]" />
						{t(item.key ?? item.label)}
					</a>
				{/each}
			</div>
		</div>
	{:else}
		{#each Object.entries(navGroups) as [group, items], gi (group)}
			{@const open = !collapsed[group]}
			{#if gi > 0}
				<div class="mx-3 border-t border-outline-variant/60" aria-hidden="true"></div>
			{/if}
			<div class="overflow-hidden rounded-xl transition-colors" class:bg-surface-container-low={!open && isGroupActive(items)}>
				<button
					onclick={() => onToggleGroup(group)}
					aria-expanded={open}
					aria-controls="nav-group-{group}"
					class="flex min-h-12 w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-container-low {isGroupActive(items) ? 'text-primary' : 'text-on-surface'}"
				>
					<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg {isGroupActive(items) ? 'bg-primary text-on-primary' : 'bg-surface-container text-secondary'}">
						<Icon name={NAV_GROUP_ICONS[group] ?? 'menu'} size="text-[18px]" />
					</span>
					<span class="flex-1 text-start text-[13px] font-bold uppercase tracking-wider">{t('nav.' + group.toLowerCase())}</span>
					<span class="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal text-secondary">{items.length}</span>
					<Icon name="expand_more" size="text-[18px]" class="text-secondary transition-transform {open ? '' : '-rotate-90 rtl:rotate-90'}" />
				</button>
				{#if open}
					<div id="nav-group-{group}" class="space-y-0.5 px-1 pb-2 pt-1">
						{#each items as item}
							<a
								href={item.route}
								onclick={onNavigate}
								title={t(item.key ?? item.label)}
								class="flex items-center gap-3 rounded-lg border-s-2 px-3 py-2.5 ps-4 text-sm font-medium transition-colors"
								class:bg-surface-container={isActive(item.route)}
								class:text-primary={isActive(item.route)}
								class:border-primary={isActive(item.route)}
								class:border-transparent={!isActive(item.route)}
								class:text-secondary={!isActive(item.route)}
								class:hover:bg-surface-container-low={!isActive(item.route)}
							>
								<Icon name={item.icon} size="text-[20px]" />
								{t(item.key ?? item.label)}
							</a>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</nav>
