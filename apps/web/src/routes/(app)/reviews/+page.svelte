<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import { dateTime } from '$lib/format'
	import type { PaginationMeta, Review } from '$lib/types'

	let items = $state<Review[]>([])
	let meta = $state<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 })
	let loading = $state(true)

	let status = $state<'pending' | 'approved' | 'rejected'>('pending')
	let rating = $state('')
	let page = $state(1)

	async function load() {
		loading = true
		try {
			const params: Record<string, string> = { page: String(page), status }
			if (rating) params.rating = rating
			const res = await api.get<{ success: boolean; data: { items: Review[]; meta: PaginationMeta } }>(
				'/api/reviews',
				params
			)
			items = res.data.items
			meta = res.data.meta
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function setStatus(next: typeof status) {
		status = next
		page = 1
		load()
	}

	function applyFilters() {
		page = 1
		load()
	}

	function onPage(p: number) {
		page = p
		load()
	}

	async function moderate(review: Review, next: 'approved' | 'rejected' | 'pending') {
		try {
			await api.patch(`/api/reviews/${review.id}`, { status: next })
			toast.success(`Review ${next === 'pending' ? 'reset to pending' : next}`)
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	async function remove(review: Review) {
		if (!confirm('Delete this review permanently?')) return
		try {
			await api.delete(`/api/reviews/${review.id}`)
			toast.success('Review deleted')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	const stars = (value: number) => '★★★★★'.slice(0, value) + '☆☆☆☆☆'.slice(0, 5 - value)
</script>

<svelte:head><title>Reviews — Merchant OS</title></svelte:head>

<div class="space-y-5">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Reviews</h1>
			<p class="mt-1 text-body-sm text-secondary">{meta.total} in “{status}”</p>
		</div>
	</div>

	<div class="flex w-fit max-w-full gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
		{#each ['pending', 'approved', 'rejected'] as const as s}
			<button
				type="button"
				class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {status === s
					? 'bg-primary text-on-primary'
					: 'text-secondary hover:bg-surface-container hover:text-on-surface'}"
				onclick={() => setStatus(s)}
			>
				{s.charAt(0).toUpperCase() + s.slice(1)}
			</button>
		{/each}
	</div>

	<Card padded={false}>
		<div class="flex flex-wrap items-center gap-2 px-5 py-3">
			<span class="text-sm text-secondary">Filter by rating</span>
			<select class="field w-auto" bind:value={rating} onchange={applyFilters}>
				<option value="">All ratings</option>
				{#each [5, 4, 3, 2, 1] as r (r)}
					<option value={String(r)}>{r} star{r === 1 ? '' : 's'}</option>
				{/each}
			</select>
		</div>
	</Card>

	<Card padded={false}>
		{#if loading}
			<div class="space-y-2 p-5">
				{#each Array(5) as _}
					<div class="h-16 animate-pulse rounded bg-surface-container"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="flex flex-col items-center gap-2 py-16 text-center">
				<Icon name="rate_review" size="text-[32px]" class="text-outline" />
				<p class="text-sm text-secondary">No {status} reviews.</p>
			</div>
		{:else}
			<ul class="divide-y divide-outline-variant/60">
				{#each items as review (review.id)}
					<li class="px-5 py-4 transition-colors hover:bg-surface-container-low">
						<div class="flex flex-wrap items-start gap-x-6 gap-y-2">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
									<span class="text-sm font-semibold text-warning" aria-hidden="true">{stars(review.rating)}</span>
									<span class="text-xs font-medium uppercase tracking-wide text-outline">{review.rating}/5</span>
									<Badge label={review.status} />
									<span class="text-xs text-secondary">{dateTime(review.createdAt)}</span>
								</div>
								<p class="mt-1.5 text-sm font-medium text-on-surface">
									{review.title ?? '(no title)'}
								</p>
								{#if review.body}
									<p class="mt-1 max-w-3xl whitespace-pre-line text-sm text-on-surface-variant">{review.body}</p>
								{/if}
							</div>
							<div class="w-full sm:w-52">
								<a href="/products/{review.productId}" class="inline-block rounded py-1 font-medium text-primary hover:bg-primary-fixed-dim/40 hover:text-on-primary-fixed-variant">
									{review.productName ?? review.productId}
								</a>
								<p class="mt-0.5 truncate text-xs text-secondary">
									by {review.authorName}{review.customerEmail ? ` · ${review.customerEmail}` : ''}
								</p>
							</div>
						</div>
						<div class="mt-3 flex flex-wrap items-center gap-2">
							{#if review.status !== 'approved'}
								<Button variant="primary" size="sm" onclick={() => moderate(review, 'approved')}>Approve</Button>
							{/if}
							{#if review.status !== 'rejected'}
								<Button variant="secondary" size="sm" onclick={() => moderate(review, 'rejected')}>Reject</Button>
							{/if}
							{#if review.status !== 'pending'}
								<Button variant="ghost" size="sm" onclick={() => moderate(review, 'pending')}>Reset to pending</Button>
							{/if}
							<Button variant="danger" size="sm" onclick={() => remove(review)}>Delete</Button>
						</div>
					</li>
				{/each}
			</ul>
			<Pagination {meta} {onPage} />
		{/if}
	</Card>
</div>
