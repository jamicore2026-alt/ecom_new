<script lang="ts">
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import ImageManager from '$lib/components/ImageManager.svelte'
	import type { Category, Product, ProductImage } from '$lib/types'

	let { product, categories, onClose, onSaved } = $props<{
		product: (Product & { images?: ProductImage[] }) | null
		categories: Category[]
		onClose: () => void
		onSaved: () => void
	}>()

	let saving = $state(false)
	let fieldErrors = $state<Record<string, string>>({})

	let name = $state(product?.name ?? '')
	let sku = $state(product?.sku ?? '')
	let barcode = $state(product?.barcode ?? '')
	let description = $state(product?.description ?? '')
	let price = $state(String(product?.price ?? ''))
	let compareAtPrice = $state(product?.compareAtPrice != null ? String(product.compareAtPrice) : '')
	let cost = $state(String(product?.cost ?? '0'))
	let category = $state(product?.categoryId ?? '')
	let trackInventory = $state(product?.trackInventory ?? true)
	let lowStockThreshold = $state(String(product?.lowStockThreshold ?? 5))
	let status = $state(product?.status ?? 'active')
	let images = $state<ProductImage[]>([...(product?.images ?? [])])

	async function submit() {
		saving = true
		fieldErrors = {}
		try {
			const body: Record<string, unknown> = {
				name,
				sku: sku || undefined,
				barcode: barcode || undefined,
				description: description || undefined,
				price: Number(price),
				compareAtPrice: compareAtPrice ? Number(compareAtPrice) : undefined,
				cost: Number(cost || 0),
				categoryId: category || undefined,
				trackInventory,
				lowStockThreshold: Number(lowStockThreshold || 0),
				status,
				images: images.map((img, i) => ({
					url: img.url,
					altText: img.altText || undefined,
					sortOrder: i
				}))
			}
			if (product) {
				await api.put<{ success: boolean }>(`/api/products/${product.id}`, body)
				toast.success('Product updated')
			} else {
				await api.post<{ success: boolean }>('/api/products', body)
				toast.success('Product created')
			}
			onSaved()
		} catch (e) {
			const err = e as { message?: string; fields?: Array<{ path: string; message: string }> }
			toast.error(err.message ?? 'Save failed')
			if (err.fields) {
				for (const f of err.fields) fieldErrors[f.path] = f.message
			}
		} finally {
			saving = false
		}
	}
</script>

<Modal title={product ? 'Edit product' : 'Add product'} open={true} width="lg" onClose={onClose}>
	<form
		onsubmit={(e) => {
			e.preventDefault()
			submit()
		}}
		class="space-y-4"
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="sm:col-span-2">
				<label for="product-name" class="field-label">Name *</label>
				<input id="product-name" class="field" bind:value={name} required />
				{#if fieldErrors.name}<p class="field-error">{fieldErrors.name}</p>{/if}
			</div>

			<div>
				<label for="sku" class="field-label">SKU</label>
				<input id="sku" class="field" bind:value={sku} />
			</div>
			<div>
				<label for="barcode" class="field-label">Barcode</label>
				<input id="barcode" class="field" bind:value={barcode} />
			</div>

			<div>
				<label for="price" class="field-label">Price *</label>
				<input id="price" type="number" step="0.01" min="0" class="field" bind:value={price} required />
			</div>
			<div>
				<label for="compare-at-price" class="field-label">Compare-at price</label>
				<input id="compare-at-price" type="number" step="0.01" min="0" class="field" bind:value={compareAtPrice} />
			</div>
			<div>
				<label for="cost" class="field-label">Cost</label>
				<input id="cost" type="number" step="0.01" min="0" class="field" bind:value={cost} />
			</div>
			<div>
				<label for="category" class="field-label">Category</label>
				<select id="category" class="field" bind:value={category}>
					<option value="">None</option>
					{#each categories as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</div>

			<div class="sm:col-span-2">
				<label for="description" class="field-label">Description</label>
				<textarea id="description" rows="3" class="field" bind:value={description}></textarea>
			</div>

			<div class="sm:col-span-2">
				<p class="field-label">Images</p>
				<ImageManager bind:images />
			</div>

			<div class="sm:col-span-2 flex items-center justify-between rounded border border-outline-variant bg-surface-container-lowest px-4 py-3">
				<label for="track-inventory" class="text-sm font-medium text-on-surface">Track inventory</label>
				<input id="track-inventory" type="checkbox" class="field-check" bind:checked={trackInventory} />
			</div>

			{#if trackInventory}
				<div class="sm:col-span-2">
					<label for="low-stock-threshold" class="field-label">Low stock threshold</label>
					<input id="low-stock-threshold" type="number" min="0" class="field max-w-40" bind:value={lowStockThreshold} />
				</div>
			{/if}

			<div>
				<label for="status" class="field-label">Status</label>
				<select id="status" class="field" bind:value={status}>
					<option value="active">Active</option>
					<option value="draft">Draft</option>
					<option value="archived">Archived</option>
				</select>
			</div>
		</div>

		<div class="flex justify-end gap-2 pt-2">
			<Button variant="secondary" onclick={onClose}>Cancel</Button>
			<Button type="submit" loading={saving}>{product ? 'Save changes' : 'Create product'}</Button>
		</div>
	</form>
</Modal>