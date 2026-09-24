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

	let name = $state('')
	let nameAr = $state('')
	let sku = $state('')
	let barcode = $state('')
	let description = $state('')
	let descriptionAr = $state('')
	let price = $state('')
	let compareAtPrice = $state('')
	let cost = $state('0')
	let category = $state('')
	let trackInventory = $state(true)
	let lowStockThreshold = $state('5')
	let status = $state('active')
	let visibility = $state('both')
	let tags = $state('')
	let weight = $state('')
	let gtin = $state('')
	let metaTitle = $state('')
	let metaDescription = $state('')
	let saleStartsAt = $state('')
	let saleEndsAt = $state('')
	let publishAt = $state('')
	let images = $state<ProductImage[]>([])

	/** ISO instant → datetime-local value (local time, no seconds). */
	function toLocalInput(iso: string | null | undefined): string {
		if (!iso) return ''
		const d = new Date(iso)
		if (Number.isNaN(d.getTime())) return ''
		const pad = (n: number) => String(n).padStart(2, '0')
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
	}

	/** datetime-local value → ISO instant (or null when empty). */
	function toIsoOrNull(v: string): string | null {
		if (!v.trim()) return null
		const d = new Date(v)
		return Number.isNaN(d.getTime()) ? null : d.toISOString()
	}

	// Sync the form from the product prop before first paint and whenever a
	// different product is passed while mounted (fresh mount per modal open
	// is the common case — the effect is a safety net for reuse).
	let lastProductId = $state<string | null>(null)
	$effect.pre(() => {
		if ((product?.id ?? null) !== lastProductId) {
			lastProductId = product?.id ?? null
			name = product?.name ?? ''
			nameAr = product?.nameAr ?? ''
			sku = product?.sku ?? ''
			barcode = product?.barcode ?? ''
			description = product?.description ?? ''
			descriptionAr = product?.descriptionAr ?? ''
			price = String(product?.price ?? '')
			compareAtPrice = product?.compareAtPrice != null ? String(product.compareAtPrice) : ''
			cost = String(product?.cost ?? '0')
			category = product?.categoryId ?? ''
			trackInventory = product?.trackInventory ?? true
			lowStockThreshold = String(product?.lowStockThreshold ?? 5)
			status = product?.status ?? 'active'
			visibility = product?.visibility ?? 'both'
			tags = (product?.tags ?? []).join(', ')
			weight = product?.weight != null ? String(product.weight) : ''
			gtin = product?.gtin ?? ''
			metaTitle = product?.metaTitle ?? ''
			metaDescription = product?.metaDescription ?? ''
			saleStartsAt = toLocalInput(product?.saleStartsAt)
			saleEndsAt = toLocalInput(product?.saleEndsAt)
			publishAt = toLocalInput(product?.publishAt)
			images = [...(product?.images ?? [])]
			fieldErrors = {}
		}
	})

	async function submit() {
		saving = true
		fieldErrors = {}
		try {
			const body: Record<string, unknown> = {
				name,
				nameAr: nameAr || undefined,
				sku: sku || undefined,
				barcode: barcode || undefined,
				description: description || undefined,
				descriptionAr: descriptionAr || undefined,
				price: Number(price),
				compareAtPrice: compareAtPrice ? Number(compareAtPrice) : null,
				cost: Number(cost || 0),
				categoryId: category || null,
				trackInventory,
				lowStockThreshold: Number(lowStockThreshold || 0),
				status,
				visibility,
				tags: tags
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean),
				weight: weight ? Number(weight) : null,
				gtin: gtin || null,
				metaTitle: metaTitle || null,
				metaDescription: metaDescription || null,
				saleStartsAt: toIsoOrNull(saleStartsAt),
				saleEndsAt: toIsoOrNull(saleEndsAt),
				publishAt: toIsoOrNull(publishAt),
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
			<div>
				<label for="product-name" class="field-label">Name *</label>
				<input id="product-name" class="field" bind:value={name} required />
				{#if fieldErrors.name}<p class="field-error">{fieldErrors.name}</p>{/if}
			</div>
			<div>
				<label for="product-name-ar" class="field-label">Name (Arabic)</label>
				<input id="product-name-ar" class="field" bind:value={nameAr} dir="rtl" />
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
				<label for="price" class="field-label">Sale Price *</label>
				<input id="price" type="number" step="0.01" min="0" class="field" bind:value={price} required />
			</div>
			<div>
				<label for="compare-at-price" class="field-label">Compare-at price</label>
				<input id="compare-at-price" type="number" step="0.01" min="0" class="field" bind:value={compareAtPrice} />
				<p class="mt-1 text-xs text-secondary">Sale price applies only inside the sale window below.</p>
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
				<label for="description-ar" class="field-label">Description (Arabic)</label>
				<textarea id="description-ar" rows="3" class="field" bind:value={descriptionAr} dir="rtl"></textarea>
			</div>

			<div class="sm:col-span-2">
				<label for="visibility" class="field-label">Visibility</label>
				<select id="visibility" class="field" bind:value={visibility}>
					<option value="both">Online store &amp; POS</option>
					<option value="website">Online store only</option>
					<option value="pos">POS only</option>
				</select>
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

			<div class="sm:col-span-2 grid gap-4 sm:grid-cols-2">
				<div>
					<label for="sale-starts" class="field-label">Sale starts at</label>
					<input id="sale-starts" type="datetime-local" class="field" bind:value={saleStartsAt} />
				</div>
				<div>
					<label for="sale-ends" class="field-label">Sale ends at</label>
					<input id="sale-ends" type="datetime-local" class="field" bind:value={saleEndsAt} />
				</div>
			</div>
			<p class="-mt-2 text-xs text-secondary sm:col-span-2">Empty bounds are open-ended. Outside the window the price reverts to the compare-at price.</p>
			<div>
				<label for="publish-at" class="field-label">Publish at (scheduled)</label>
				<input id="publish-at" type="datetime-local" class="field" bind:value={publishAt} />
				<p class="mt-1 text-xs text-secondary">Empty = visible now.</p>
			</div>
			<div>
				<label for="weight" class="field-label">Weight (kg)</label>
				<input id="weight" type="number" step="0.001" min="0" class="field" bind:value={weight} />
			</div>
			<div>
				<label for="gtin" class="field-label">GTIN</label>
				<input id="gtin" class="field" maxlength="32" bind:value={gtin} placeholder="EAN / UPC / ISBN" />
			</div>
			<div>
				<label for="tags" class="field-label">Tags (comma separated)</label>
				<input id="tags" class="field" bind:value={tags} placeholder="summer, cotton, new" />
			</div>
			<div>
				<label for="meta-title" class="field-label">SEO title</label>
				<input id="meta-title" class="field" maxlength="255" bind:value={metaTitle} placeholder="Defaults to product name" />
			</div>
			<div class="sm:col-span-2">
				<label for="meta-description" class="field-label">SEO description</label>
				<textarea id="meta-description" rows="2" class="field" bind:value={metaDescription} placeholder="Defaults to product description"></textarea>
			</div>

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