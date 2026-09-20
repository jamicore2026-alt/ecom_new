<script lang="ts">
	import { t } from '$lib/i18n'
	import type { StoreInfo } from '$lib/types'

	interface Props {
		slug: string
		store: StoreInfo
	}

	let { slug, store }: Props = $props()

	// settings.address is a free-form record — render whatever the merchant set.
	const addressText = $derived(
		Object.values(store.settings.address ?? {})
			.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
			.map(String)
			.map((s) => s.trim())
			.filter(Boolean)
			.join(', ')
	)
</script>

<footer class="mt-16 border-t border-neutral-200 bg-white">
	<div class="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
		<div>
			<p class="font-semibold text-neutral-900">{store.settings.name}</p>
			{#if addressText}
				<p class="mt-2 text-neutral-500">{addressText}</p>
			{/if}
			<p class="mt-4 text-neutral-500">© {new Date().getFullYear()} {store.settings.name}. {t('footer.allRights')}</p>
		</div>
		<nav class="flex flex-col gap-1" aria-label={store.settings.name}>
			<a href={`/${slug}`} class="inline-flex min-h-11 items-center text-neutral-500 hover:text-neutral-900">{t('navigation.home')}</a>
			<a href={`/${slug}/products`} class="inline-flex min-h-11 items-center text-neutral-500 hover:text-neutral-900">{t('navigation.shop')}</a>
			<a href={`/${slug}/orders/lookup`} class="inline-flex min-h-11 items-center text-neutral-500 hover:text-neutral-900">{t('orders.lookupTitle')}</a>
		</nav>
		<nav class="flex flex-col gap-1" aria-label={t('navigation.account')}>
			<a href={`/${slug}/account`} class="inline-flex min-h-11 items-center text-neutral-500 hover:text-neutral-900">{t('navigation.account')}</a>
			<a href={`/${slug}/wishlist`} class="inline-flex min-h-11 items-center text-neutral-500 hover:text-neutral-900">{t('navigation.wishlist')}</a>
			<a href={`/${slug}/cart`} class="inline-flex min-h-11 items-center text-neutral-500 hover:text-neutral-900">{t('navigation.cart')}</a>
		</nav>
	</div>
</footer>
