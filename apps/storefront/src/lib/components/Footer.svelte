<script lang="ts">
	import type { StoreInfo } from '$lib/types'

	interface Props {
		slug: string
		store: StoreInfo
	}

	let { slug, store }: Props = $props()
</script>

<footer class="mt-16 border-t border-gray-200 bg-white">
	<div class="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-gray-500 sm:flex-row">
		<p>© {new Date().getFullYear()} {store.settings.name}. All rights reserved.</p>
		<nav class="flex flex-wrap items-center justify-center gap-4">
			<a href={`/${slug}`} class="hover:text-gray-900">Home</a>
			<a href={`/${slug}/products`} class="hover:text-gray-900">Shop</a>
		</nav>
	</div>
</footer>
