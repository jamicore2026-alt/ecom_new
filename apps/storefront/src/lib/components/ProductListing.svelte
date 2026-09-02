<script lang="ts">
	import type { Page, ProductSummary } from '$lib/types'
	import ProductCard from './ProductCard.svelte'
	import { qs } from '$lib/api'
	import { t } from '$lib/i18n'

	interface Props {
		page: Page<ProductSummary>
		storeSlug: string
		currency?: string
		basePath: string
		query?: Record<string, string>
	}

	let { page, storeSlug, currency = 'USD', basePath, query = {} }: Props = $props()

	const pageUrl = (n: number) => `${basePath}${qs({ ...query, page: n })}`
	const prevPage = $derived(page.meta.page > 1 ? page.meta.page - 1 : null)
	const nextPage = $derived(page.meta.page < page.meta.totalPages ? page.meta.page + 1 : null)
</script>

{#if page.items.length}
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
		{#each page.items as product (product.id)}
			<ProductCard {product} {storeSlug} {currency} />
		{/each}
	</div>

	{#if page.meta.totalPages > 1}
		<nav class="mt-10 flex items-center justify-center gap-3">
			{#if prevPage}
				<a
					href={pageUrl(prevPage)}
					class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
				>
					Previous
				</a>
			{/if}
			<span class="px-2 text-sm text-gray-500">
				Page {page.meta.page} of {page.meta.totalPages}
			</span>
			{#if nextPage}
				<a
					href={pageUrl(nextPage)}
					class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
				>
					Next
				</a>
			{/if}
		</nav>
	{/if}
{:else}
	<p class="py-16 text-center text-gray-500">{t('products.noProducts')}</p>
{/if}
