<script lang="ts">
	import { goto } from '$app/navigation'
	import Icon from '$lib/components/Icon.svelte'
	import { t } from '$lib/i18n'
	import type { AppModule, NavItem } from '$lib/navigation'

	interface Props {
		open: boolean
		/** Modules with at least one visible item, in config order. */
		modules: Array<{ module: AppModule; items: NavItem[] }>
		activeModuleId: string | null
		onClose: () => void
		onSelectModule: (id: string | null) => void
	}

	let { open, modules, activeModuleId, onClose, onSelectModule }: Props = $props()

	function choose(id: string | null, firstRoute?: string) {
		onSelectModule(id)
		onClose()
		if (firstRoute) goto(firstRoute)
	}
</script>

{#if open}
	<!-- Desktop: dropdown panel under the header button -->
	<div class="fixed inset-0 z-40 hidden sm:block" onclick={onClose} aria-hidden="true"></div>
	<div
		class="fixed start-4 top-[4.25rem] z-50 hidden w-80 rounded-2xl border border-outline-variant bg-surface p-3 shadow-xl sm:block"
		role="dialog"
		aria-label={t('nav.launcherTitle')}
	>
		<p class="px-2 pb-2 text-[11px] font-bold uppercase tracking-widest text-secondary">{t('nav.launcherTitle')}</p>
		<div class="grid grid-cols-2 gap-2">
			{#each modules as { module, items } (module.id)}
				{@const active = activeModuleId === module.id}
				<button
					onclick={() => choose(module.id, items[0]?.route)}
					aria-pressed={active}
					class="flex flex-col items-start gap-2 rounded-xl border p-3 text-start transition-colors hover:bg-surface-container-low {active ? 'border-primary bg-surface-container' : 'border-outline-variant'}"
				>
					<span class="flex h-9 w-9 items-center justify-center rounded-lg {active ? 'bg-primary text-on-primary' : 'bg-surface-container text-secondary'}">
						<Icon name={module.icon} size="text-[20px]" />
					</span>
					<span class="text-sm font-semibold text-on-surface">{t(module.labelKey)}</span>
					<span class="text-xs text-secondary">{items.length} items</span>
				</button>
			{/each}
		</div>
		<button
			onclick={() => choose(null)}
			class="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-surface-container-low"
		>
			<Icon name="apps" size="text-[18px]" />
			{t('nav.allItems')}
		</button>
	</div>

	<!-- Mobile: full-screen sheet -->
	<div class="fixed inset-0 z-50 flex flex-col bg-surface sm:hidden" role="dialog" aria-label={t('nav.launcherTitle')}>
		<div class="flex h-16 shrink-0 items-center justify-between border-b border-outline-variant px-4">
			<p class="text-[13px] font-bold uppercase tracking-widest text-secondary">{t('nav.launcherTitle')}</p>
			<button
				onclick={onClose}
				aria-label="Close"
				class="flex h-11 w-11 items-center justify-center rounded text-secondary hover:bg-surface-container"
			>
				<Icon name="close" size="text-[22px]" />
			</button>
		</div>
		<div class="grid flex-1 content-start grid-cols-2 gap-3 overflow-y-auto p-4">
			{#each modules as { module, items } (module.id)}
				{@const active = activeModuleId === module.id}
				<button
					onclick={() => choose(module.id, items[0]?.route)}
					aria-pressed={active}
					class="flex min-h-24 flex-col items-start gap-2 rounded-2xl border p-4 text-start {active ? 'border-primary bg-surface-container' : 'border-outline-variant'}"
				>
					<span class="flex h-10 w-10 items-center justify-center rounded-xl {active ? 'bg-primary text-on-primary' : 'bg-surface-container text-secondary'}">
						<Icon name={module.icon} size="text-[22px]" />
					</span>
					<span class="text-sm font-semibold text-on-surface">{t(module.labelKey)}</span>
					<span class="text-xs text-secondary">{items.length} items</span>
				</button>
			{/each}
		</div>
		<div class="shrink-0 border-t border-outline-variant p-4">
			<button
				onclick={() => choose(null)}
				class="flex w-full items-center justify-center gap-2 rounded-xl border border-outline-variant px-4 py-3 text-sm font-medium text-secondary"
			>
				<Icon name="apps" size="text-[18px]" />
				{t('nav.allItems')}
			</button>
		</div>
	</div>
{/if}
