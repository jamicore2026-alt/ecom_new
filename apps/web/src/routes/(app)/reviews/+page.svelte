<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
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

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold text-gray-900">Reviews</h1>
			<p class="text-sm text-gray-500">{meta.total} in “{status}”</p>
		</div>
	</div>

	<Card padded={false}>
		<div class="flex flex-wrap items-center gap-2 px-5 py-3">
			{#each ['pending', 'approved', 'rejected'] as const as s}
				<button
					type="button"
					class="rounded-full px-4 py-1.5 text-sm font-medium transition {status === s
						? 'bg-gray-900 text-white'
						: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
					onclick={() => setStatus(s)}
				>
					{s.charAt(0).toUpperCase() + s.slice(1)}
				</button>
			{/each}
			<select class="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm" bind:value={rating} onchange={applyFilters}>
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
					<div class="h-16 animate-pulse rounded-lg bg-gray-100"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<p class="py-14 text-center text-sm text-gray-400">No {status} reviews.</p>
		{:else}
			<ul class="divide-y divide-gray-100">
				{#each items as review (review.id)}
					<li class="px-5 py-4 hover:bg-gray-50/60">
						<div class="flex flex-wrap items-start gap-x-6 gap-y-2">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
									<span class="text-sm font-semibold text-amber-500" aria-hidden="true">{stars(review.rating)}</span>
									<span class="text-xs font-medium uppercase tracking-wide text-gray-400">{review.rating}/5</span>
									<Badge label={review.status} />
									<span class="text-xs text-gray-400">{dateTime(review.createdAt)}</span>
								</div>
								<p class="mt-1.5 text-sm font-medium text-gray-900">
									{review.title ?? '(no title)'}
								</p>
								{#if review.body}
									<p class="mt-1 max-w-3xl whitespace-pre-line text-sm text-gray-600">{review.body}</p>
								{/if}
							</div>
							<div class="w-full sm:w-52">
								<a href="/products/{review.productId}" class="block truncate text-sm font-medium text-indigo-600 hover:text-indigo-800">
									{review.productName ?? review.productId}
								</a>
								<p class="mt-0.5 truncate text-xs text-gray-500">
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
