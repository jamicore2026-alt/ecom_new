<script lang="ts">
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import ImageManager from '$lib/components/ImageManager.svelte'
	import { currency, dateTimeFull, number } from '$lib/format'
	import type { ProductDetail, ProductImage, ProductVariant } from '$lib/types'
	import { page } from '$app/state'

	let product = $state<ProductDetail | null>(null)
	let loading = $state(true)
	let savingImages = $state(false)
	let id = $derived(page.params.id)
	let images = $state<ProductImage[]>([])

	let editVariant = $state<ProductVariant | null>(null)
	let variantModal = $state(false)

	// variant form
	let vSku = $state('')
	let vPrice = $state('')
	let vCompareAt = $state('')
	let vInventory = $state('0')
	let vImage = $state('')
	let optionValues = $state<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
	let vSaving = $state(false)
	let vFieldErrors = $state<Record<string, string>>({})

	const canWrite = () => session.can('products:write')

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: ProductDetail }>(`/api/products/${id}`)
			product = res.data
			images = [...(res.data.images ?? [])]
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	async function saveImages() {
		if (!product) return
		savingImages = true
		try {
			await api.put<{ success: boolean }>(`/api/products/${product.id}`, {
				images: images.map((img, i) => ({
					url: img.url,
					altText: img.altText || undefined,
					sortOrder: i
				}))
			})
			toast.success('Images updated')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			savingImages = false
		}
	}

	$effect(() => {
		load()
	})

	function openAddVariant() {
		editVariant = null
		vSku = ''
		vPrice = product ? String(product.price) : ''
		vCompareAt = ''
		vInventory = '0'
		vImage = ''
		optionValues = [{ key: '', value: '' }]
		variantModal = true
	}

	function openEditVariant(v: ProductVariant) {
		editVariant = v
		vSku = v.sku ?? ''
		vPrice = String(v.price)
		vCompareAt = v.compareAtPrice != null ? String(v.compareAtPrice) : ''
		vInventory = String(v.inventory)
		vImage = v.image ?? ''
		optionValues = Object.entries(v.optionValues ?? {}).map(([key, value]) => ({ key, value }))
		if (optionValues.length === 0) optionValues = [{ key: '', value: '' }]
		variantModal = true
	}

	async function saveVariant() {
		vSaving = true
		vFieldErrors = {}
		try {
			const ov: Record<string, string> = {}
			for (const row of optionValues) {
				if (row.key.trim()) ov[row.key.trim()] = row.value.trim()
			}
			const body: Record<string, unknown> = {
				sku: vSku || undefined,
				optionValues: ov,
				price: vPrice ? Number(vPrice) : undefined,
				compareAtPrice: vCompareAt ? Number(vCompareAt) : undefined,
				inventory: Number(vInventory || 0),
				image: vImage || undefined
			}
			if (editVariant) {
				await api.put<{ success: boolean }>(`/api/variants/${editVariant.id}`, body)
				toast.success('Variant updated')
			} else if (product) {
				await api.post<{ success: boolean }>(`/api/products/${product.id}/variants`, body)
				toast.success('Variant added')
			}
			variantModal = false
			load()
		} catch (e) {
			const err = e as { message?: string; fields?: Array<{ path: string; message: string }> }
			toast.error(err.message ?? 'Save failed')
			if (err.fields) {
				for (const f of err.fields) vFieldErrors[f.path] = f.message
			}
		} finally {
			vSaving = false
		}
	}

	async function deleteVariant(v: ProductVariant) {
		if (!confirm('Delete this variant?')) return
		try {
			await api.delete<{ success: boolean }>(`/api/variants/${v.id}`)
			toast.success('Variant deleted')
			load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}
</script>

{#if loading}
	<div class="h-40 animate-pulse rounded-xl bg-gray-200"></div>
{:else if product}
	<div class="space-y-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<a href="/products" class="text-sm text-gray-500 hover:text-gray-700">← Products</a>
				<h1 class="text-xl font-bold text-gray-900">{product.name}</h1>
				<p class="text-sm text-gray-500">
					{product.sku ?? 'No SKU'} · {product.category?.name ?? 'Uncategorized'} ·
					{number(product.stock)} units in stock
				</p>
			</div>
			{#if canWrite()}
				<Button onclick={openAddVariant}>Add variant</Button>
			{/if}
		</div>

		<div class="grid gap-5 lg:grid-cols-3">
			<div class="space-y-5 lg:col-span-1">
				<Card title="Details">
					<dl class="space-y-2 text-sm">
						<div class="flex justify-between"><dt class="text-gray-500">Price</dt><dd class="font-medium">{currency(product.price)}</dd></div>
						{#if product.compareAtPrice != null}
							<div class="flex justify-between"><dt class="text-gray-500">Compare-at</dt><dd class="font-medium text-gray-700 line-through">{currency(product.compareAtPrice)}</dd></div>
						{/if}
						<div class="flex justify-between"><dt class="text-gray-500">Cost</dt><dd class="font-medium">{currency(product.cost)}</dd></div>
						<div class="flex justify-between"><dt class="text-gray-500">Status</dt><dd><Badge label={product.status} /></dd></div>
						<div class="flex justify-between"><dt class="text-gray-500">Track inventory</dt><dd class="font-medium">{product.trackInventory ? 'Yes' : 'No'}</dd></div>
						<div class="flex justify-between"><dt class="text-gray-500">Low-stock threshold</dt><dd class="font-medium">{product.lowStockThreshold}</dd></div>
						<div class="flex justify-between"><dt class="text-gray-500">Slug</dt><dd class="font-mono text-xs text-gray-700">{product.slug}</dd></div>
						<div class="flex justify-between"><dt class="text-gray-500">Created</dt><dd class="text-gray-700">{dateTimeFull(product.createdAt)}</dd></div>
					</dl>
				</Card>

				{#if product.description}
					<Card title="Description">
						<p class="whitespace-pre-line text-sm text-gray-600">{product.description}</p>
					</Card>
				{/if}

				{#if canWrite()}
					<Card title="Images">
						<div class="space-y-3">
							<ImageManager bind:images />
							<Button variant="secondary" loading={savingImages} onclick={saveImages}>Save images</Button>
						</div>
					</Card>
				{/if}
			</div>

			<div class="lg:col-span-2">
				<Card title={`Variants (${product.variants.length})`} padded={false}>
					{#if product.variants.length === 0}
						<p class="py-10 text-center text-sm text-gray-400">No variants yet.</p>
					{:else}
						<div class="overflow-x-auto">
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
										<th class="px-5 py-3">Options</th>
										<th class="px-3 py-3">SKU</th>
										<th class="px-3 py-3">Price</th>
										<th class="px-3 py-3">Inventory</th>
										<th class="px-5 py-3 text-right">Actions</th>
									</tr>
								</thead>
								<tbody>
									{#each product.variants as v (v.id)}
										<tr class="border-b border-gray-50 hover:bg-gray-50/60">
											<td class="px-5 py-3">
												{#if v.image}
													<img src={v.image} alt="" class="mr-2 inline h-8 w-8 rounded object-cover" />
												{/if}
												{#if Object.keys(v.optionValues ?? {}).length}
													<span class="text-gray-700">
														{Object.entries(v.optionValues).map(([k, val]) => `${k}: ${val}`).join(', ')}
													</span>
												{:else}
													<span class="text-gray-400">Default</span>
												{/if}
											</td>
											<td class="px-3 py-3 text-gray-600">{v.sku ?? '—'}</td>
											<td class="px-3 py-3 font-medium">{currency(v.price)}</td>
											<td class="px-3 py-3" class:font-semibold={true} class:text-red-600={v.inventory === 0}>
												{number(v.inventory)}
											</td>
											<td class="px-5 py-3 text-right">
												{#if canWrite()}
													<button class="text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => openEditVariant(v)}>Edit</button>
													<span class="mx-1 text-gray-300">|</span>
													<button class="text-xs font-medium text-red-600 hover:text-red-800" onclick={() => deleteVariant(v)}>Delete</button>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</Card>
			</div>
		</div>
	</div>
{:else}
	<p class="text-sm text-gray-500">Product not found.</p>
{/if}

{#if variantModal && canWrite()}
	<Modal title={editVariant ? 'Edit variant' : 'Add variant'} open={true} width="sm" onClose={() => (variantModal = false)}>
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault()
				saveVariant()
			}}
		>
			<div>
				<label for="v-sku" class="mb-1 block text-sm font-medium text-gray-700">SKU</label>
				<input id="v-sku" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={vSku} />
			</div>

			<div>
				<label for="v-price" class="mb-1 block text-sm font-medium text-gray-700">Price</label>
				<input id="v-price" type="number" step="0.01" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={vPrice} />
			</div>

			<div>
				<label for="v-compare-at" class="mb-1 block text-sm font-medium text-gray-700">Compare-at price</label>
				<input id="v-compare-at" type="number" step="0.01" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={vCompareAt} />
			</div>

			<div>
				<label for="v-inventory" class="mb-1 block text-sm font-medium text-gray-700">Inventory</label>
				<input id="v-inventory" type="number" min="0" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={vInventory} />
				{#if vFieldErrors.inventory}<p class="mt-1 text-xs text-red-600">{vFieldErrors.inventory}</p>{/if}
			</div>

			<div>
				<label for="v-image" class="mb-1 block text-sm font-medium text-gray-700">Image URL</label>
				<input id="v-image" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" bind:value={vImage} placeholder="https://…" />
			</div>

			<div>
				<p class="mb-1 block text-sm font-medium text-gray-700">Options (Size, Color, …)</p>
				<div class="space-y-2">
					{#each optionValues as row, i (i)}
						<div class="flex gap-2">
							<input class="w-1/3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" placeholder="Size" bind:value={optionValues[i].key} />
							<input class="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" placeholder="M" bind:value={optionValues[i].value} />
							<button
								type="button"
								class="px-2 text-gray-400 hover:text-red-600"
								onclick={() => (optionValues = optionValues.filter((_, j) => j !== i))}
							>
								×
							</button>
						</div>
					{/each}
				</div>
				<button type="button" class="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800" onclick={() => (optionValues = [...optionValues, { key: '', value: '' }])}>
					+ Add option
				</button>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (variantModal = false)}>Cancel</Button>
				<Button type="submit" loading={vSaving}>Save variant</Button>
			</div>
		</form>
	</Modal>
{/if}
