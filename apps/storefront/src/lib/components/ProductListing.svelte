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
				class="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
			>
				{t('pagination.previous')}
			</a>
		{/if}
		<span class="px-2 text-sm text-neutral-500">
			{t('pagination.pageOf').replace('{page}', String(page.meta.page)).replace('{total}', String(page.meta.totalPages))}
		</span>
		{#if nextPage}
			<a
				href={pageUrl(nextPage)}
				class="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
			>
				{t('pagination.next')}
			</a>
		{/if}
		</nav>
	{/if}
{:else}
	<p class="py-16 text-center text-neutral-500">{t('products.noProducts')}</p>
{/if}
