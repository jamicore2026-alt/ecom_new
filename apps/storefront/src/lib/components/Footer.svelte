<script lang="ts">
	import { t } from '$lib/i18n'
	import type { StoreInfo } from '$lib/types'

	interface Props {
		slug: string
		store: StoreInfo
	}

	let { slug, store }: Props = $props()
</script>

<footer class="mt-16 border-t border-gray-200 bg-white">
	<div class="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-gray-500 sm:flex-row">
		<p>© {new Date().getFullYear()} {store.settings.name}. {t('footer.allRights')}</p>
		<nav class="flex flex-wrap items-center justify-center gap-4">
			<a href={`/${slug}`} class="hover:text-gray-900">{t('navigation.home')}</a>
			<a href={`/${slug}/products`} class="hover:text-gray-900">{t('navigation.shop')}</a>
		</nav>
	</div>
</footer>
