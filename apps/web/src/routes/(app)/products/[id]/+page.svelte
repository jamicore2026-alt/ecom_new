<script lang="ts">
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import ImageManager from '$lib/components/ImageManager.svelte'
	import { currency, dateTimeFull, number, handleImageError } from '$lib/format'
	import type { ProductDetail, ProductImage, ProductOption, ProductVariant } from '$lib/types'
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
	let vUnlimited = $state(false)
	let vImage = $state('')
	let optionValues = $state<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
	let vSaving = $state(false)
	let vFieldErrors = $state<Record<string, string>>({})

	// options / variations editor
	type OptionDraft = {
		name: string
		nameAr: string
		type: 'radio' | 'checkbox'
		required: boolean
		minSelections: string
		maxSelections: string
		perValueQuantity: boolean
		values: Array<{ value: string; valueAr: string; priceAdjustment: string; quantity: string }>
	}
	let options = $state<ProductOption[]>([])
	let optionDrafts = $state<OptionDraft[]>([])
	let optionsModal = $state(false)
	let optSaving = $state(false)
	let genBusy = $state(false)

	const canWrite = () => session.can('products:write')

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: ProductDetail }>(`/api/products/${id}`)
			product = res.data
			images = [...(res.data.images ?? [])]
			options = res.data.options ?? []
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
		vUnlimited = false
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
		vUnlimited = v.unlimited ?? false
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
				unlimited: vUnlimited,
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

	function openOptionsEditor() {
		optionDrafts = options.map((o) => ({
			name: o.name,
			nameAr: o.nameAr ?? '',
			type: o.type ?? 'radio',
			required: o.required,
			minSelections: String(o.minSelections),
			maxSelections: String(o.maxSelections),
			perValueQuantity: o.allowControl?.perValueQuantity ?? false,
			values: o.values.map((v) => ({
				value: v.value,
				valueAr: v.valueAr ?? '',
				priceAdjustment: String(v.priceAdjustment ?? 0),
				quantity: v.quantity != null ? String(v.quantity) : '0'
			}))
		}))
		if (optionDrafts.length === 0) optionDrafts = [newOptionDraft()]
		optionsModal = true
	}

	const newOptionDraft = (): OptionDraft => ({
		name: '',
		nameAr: '',
		type: 'radio',
		required: true,
		minSelections: '1',
		maxSelections: '1',
		perValueQuantity: false,
		values: [{ value: '', valueAr: '', priceAdjustment: '0', quantity: '0' }]
	})

	function addOptionDraft() {
		optionDrafts = [...optionDrafts, newOptionDraft()]
	}

	function removeOptionDraft(i: number) {
		optionDrafts = optionDrafts.filter((_, j) => j !== i)
	}

	function addOptionValue(i: number) {
		optionDrafts[i].values = [...optionDrafts[i].values, { value: '', valueAr: '', priceAdjustment: '0', quantity: '0' }]
		optionDrafts = [...optionDrafts]
	}

	function removeOptionValue(i: number, j: number) {
		optionDrafts[i].values = optionDrafts[i].values.filter((_, k) => k !== j)
		optionDrafts = [...optionDrafts]
	}

	async function saveOptions() {
		optSaving = true
		try {
			await api.put<{ success: boolean }>(`/api/products/${product?.id}/options`, {
				options: optionDrafts
					.filter((o) => o.name.trim())
					.map((o) => ({
						name: o.name.trim(),
						nameAr: o.nameAr.trim() || undefined,
						type: o.type,
						required: o.required,
						minSelections: Number(o.minSelections) || 0,
						maxSelections: Number(o.maxSelections) || 1,
						perValueQuantity: o.perValueQuantity,
						values: o.values
							.filter((v) => v.value.trim())
							.map((v) => ({
								value: v.value.trim(),
								valueAr: v.valueAr.trim() || undefined,
								priceAdjustment: Number(v.priceAdjustment) || 0,
								quantity: Number(v.quantity) || 0
							}))
					}))
			})
			toast.success('Options saved')
			optionsModal = false
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			optSaving = false
		}
	}

	async function generateVariants() {
		if (!product) return
		genBusy = true
		try {
			const res = await api.post<{ success: boolean; data: { created: number } }>(`/api/products/${product.id}/variants/generate`)
			toast.success(
				res.data.created > 0
					? `Generated ${res.data.created} variant combination${res.data.created === 1 ? '' : 's'}`
					: 'All combinations already exist'
			)
			load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			genBusy = false
		}
	}
</script>

{#if loading}
	<div class="h-40 animate-pulse rounded-xl bg-surface-container-high"></div>
{:else if product}
	<div class="space-y-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<a href="/products" class="text-sm text-secondary hover:text-on-surface-variant">← Products</a>
				<h1 class="text-xl font-bold text-on-surface">{product.name}</h1>
				<p class="text-sm text-secondary">
					{product.sku ?? 'No SKU'} · {product.category?.name ?? 'Uncategorized'} ·
					{number(product.stock)} units in stock
				</p>
			</div>
			{#if canWrite()}
				<Button onclick={openAddVariant}>Add variant</Button>
			{/if}
		</div>

		<div class="grid gap-5 lg:grid-cols-3">
			<div class="min-w-0 space-y-5 lg:col-span-1">
				<Card title="Details">
					<dl class="space-y-2 text-sm">
						<div class="flex justify-between"><dt class="text-secondary">Price</dt><dd class="font-medium">{currency(product.price)}</dd></div>
						{#if product.compareAtPrice != null}
							<div class="flex justify-between"><dt class="text-secondary">Compare-at</dt><dd class="font-medium text-on-surface-variant line-through">{currency(product.compareAtPrice)}</dd></div>
						{/if}
						<div class="flex justify-between"><dt class="text-secondary">Cost</dt><dd class="font-medium">{currency(product.cost)}</dd></div>
						<div class="flex justify-between"><dt class="text-secondary">Status</dt><dd><Badge label={product.status} /></dd></div>
						<div class="flex justify-between"><dt class="text-secondary">Track inventory</dt><dd class="font-medium">{product.trackInventory ? 'Yes' : 'No'}</dd></div>
						<div class="flex justify-between"><dt class="text-secondary">Low-stock threshold</dt><dd class="font-medium">{product.lowStockThreshold}</dd></div>
						<div class="flex justify-between"><dt class="text-secondary">Slug</dt><dd class="font-mono text-xs text-on-surface-variant">{product.slug}</dd></div>
						<div class="flex justify-between"><dt class="text-secondary">Created</dt><dd class="text-on-surface-variant">{dateTimeFull(product.createdAt)}</dd></div>
					</dl>
				</Card>

				{#if product.description}
					<Card title="Description">
						<p class="whitespace-pre-line text-sm text-on-surface-variant">{product.description}</p>
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

			<div class="min-w-0 lg:col-span-2">
				<Card title={`Variants (${product.variants.length})`} padded={false}>
					{#if product.variants.length === 0}
						<p class="py-10 text-center text-sm text-secondary">No variants yet.</p>
					{:else}
						<div class="overflow-x-auto">
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-outline-variant text-left text-xs font-medium uppercase tracking-wide text-secondary">
										<th class="px-5 py-3">Options</th>
										<th class="px-3 py-3">SKU</th>
										<th class="px-3 py-3">Price</th>
										<th class="px-3 py-3">Inventory</th>
										<th class="px-5 py-3 text-right">Actions</th>
									</tr>
								</thead>
								<tbody>
									{#each product.variants as v (v.id)}
										<tr class="border-b border-outline-variant hover:bg-surface-container-low">
											<td class="px-5 py-3">
												{#if v.image}
													<img src={v.image} alt="" class="mr-2 inline h-8 w-8 rounded object-cover" onerror={handleImageError} />
												{/if}
												{#if Object.keys(v.optionValues ?? {}).length}
													<span class="text-on-surface-variant">
														{Object.entries(v.optionValues).map(([k, val]) => `${k}: ${val}`).join(', ')}
													</span>
												{:else}
													<span class="text-secondary">Default</span>
												{/if}
											</td>
											<td class="px-3 py-3 text-on-surface-variant">{v.sku ?? '—'}</td>
											<td class="px-3 py-3 font-medium">{currency(v.price)}</td>
											<td class="px-3 py-3">
												{#if v.unlimited}
													<span class="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info ring-1 ring-inset ring-info/30">∞ Unlimited</span>
												{:else}
													<span class:font-semibold={true} class:text-error={v.inventory === 0}>{number(v.inventory)}</span>
												{/if}
											</td>
											<td class="px-5 py-3 text-right">
												{#if canWrite()}
													<button class="text-xs font-medium text-primary hover:text-on-primary-fixed-variant" onclick={() => openEditVariant(v)}>Edit</button>
													<span class="mx-1 text-outline">|</span>
													<button class="text-xs font-medium text-error hover:text-error" onclick={() => deleteVariant(v)}>Delete</button>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</Card>

				{#if canWrite()}
					<Card title="Options & variation" padded={false}>
						<div class="space-y-3 p-5">
							{#if options.length === 0}
								<p class="text-sm text-secondary">No options defined yet. Add options like Size or Color, then generate the combination variants.</p>
							{:else}
								<ul class="grid gap-3 sm:grid-cols-2">
									{#each options as o (o.id)}
										<li class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
											<div class="flex items-center justify-between gap-2">
												<p class="font-medium text-on-surface">
													{o.name}{o.nameAr ? <span class="text-secondary"> · {o.nameAr}</span> : ''}
												</p>
												<div class="flex gap-1">
													<Badge label={o.required ? 'Required' : 'Optional'} />
													{#if o.maxSelections > 1}<Badge label={`${o.maxSelections} max`} />{/if}
												</div>
											</div>
											<div class="mt-2 flex flex-wrap gap-1">
												{#each o.values as v (v.id)}
													<span class="rounded-full bg-surface-container px-2 py-0.5 text-xs text-on-surface-variant">
														{v.value}{v.valueAr ? ` / ${v.valueAr}` : ''}{v.priceAdjustment ? ` · +${currency(v.priceAdjustment)}` : ''}
														{o.allowControl?.perValueQuantity && v.quantity != null ? ` · ${v.quantity}` : ''}
													</span>
												{/each}
											</div>
										</li>
									{/each}
								</ul>
							{/if}
							<div class="flex flex-wrap gap-2">
								<Button variant="secondary" onclick={openOptionsEditor}>Edit options</Button>
								<Button variant="secondary" loading={genBusy} onclick={generateVariants}>Generate variants</Button>
							</div>
						</div>
					</Card>
				{/if}
			</div>
		</div>
	</div>
{:else}
	<p class="text-sm text-secondary">Product not found.</p>
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
				<label for="v-sku" class="mb-1 block text-sm font-medium text-on-surface-variant">SKU</label>
				<input id="v-sku" class="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm" bind:value={vSku} />
			</div>

			<div>
				<label for="v-price" class="mb-1 block text-sm font-medium text-on-surface-variant">Price</label>
				<input id="v-price" type="number" step="0.01" min="0" class="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm" bind:value={vPrice} />
			</div>

			<div>
				<label for="v-compare-at" class="mb-1 block text-sm font-medium text-on-surface-variant">Compare-at price</label>
				<input id="v-compare-at" type="number" step="0.01" min="0" class="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm" bind:value={vCompareAt} />
			</div>

			<div>
				<label for="v-inventory" class="mb-1 block text-sm font-medium text-on-surface-variant">Inventory</label>
				<input id="v-inventory" type="number" min="0" class="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm disabled:bg-surface-container disabled:text-outline" disabled={vUnlimited} bind:value={vInventory} />
				{#if vFieldErrors.inventory}<p class="mt-1 text-xs text-error">{vFieldErrors.inventory}</p>{/if}
				<label class="mt-2 flex items-center gap-2 text-sm text-on-surface-variant">
					<input type="checkbox" class="h-4 w-4 rounded border-outline-variant" bind:checked={vUnlimited} />
					<span>Unlimited <span class="text-secondary">(never runs out — quantity box disabled)</span></span>
				</label>
			</div>

			<div>
				<label for="v-image" class="mb-1 block text-sm font-medium text-on-surface-variant">Image URL</label>
				<input id="v-image" class="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm" bind:value={vImage} placeholder="https://…" />
			</div>

			<div>
				<p class="mb-1 block text-sm font-medium text-on-surface-variant">Options (Size, Color, …)</p>
				<div class="space-y-2">
					{#each optionValues as row, i (i)}
						<div class="flex gap-2">
							<input class="w-1/3 rounded-lg border border-outline-variant px-3 py-1.5 text-sm" placeholder="Size" bind:value={optionValues[i].key} />
							<input class="flex-1 rounded-lg border border-outline-variant px-3 py-1.5 text-sm" placeholder="M" bind:value={optionValues[i].value} />
							<button
								type="button"
								class="px-2 text-secondary hover:text-error"
								onclick={() => (optionValues = optionValues.filter((_, j) => j !== i))}
							>
								×
							</button>
						</div>
					{/each}
				</div>
				<button type="button" class="mt-2 text-xs font-medium text-primary hover:text-on-primary-fixed-variant" onclick={() => (optionValues = [...optionValues, { key: '', value: '' }])}>
					+ Add option
				</button>
			</div>

			{/* svelte-ignore a11y_label_has_associated_control */}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (variantModal = false)}>Cancel</Button>
				<Button type="submit" loading={vSaving}>Save variant</Button>
			</div>
		</form>
	</Modal>
{/if}

{#if optionsModal && canWrite() && product}
	<Modal title="Edit options & variations" open={true} width="lg" onClose={() => (optionsModal = false)}>
		<form
			class="space-y-5"
			onsubmit={(e) => {
				e.preventDefault()
				saveOptions()
			}}
		>
			{#each optionDrafts as opt, i (i)}
				<div class="rounded-xl border border-outline-variant p-4">
					<div class="flex items-center justify-between">
						<p class="text-sm font-medium text-on-surface">Option {i + 1}</p>
						<button type="button" class="text-xs text-error hover:underline" onclick={() => removeOptionDraft(i)}>Remove option</button>
					</div>
					<div class="mt-3 grid gap-3 sm:grid-cols-2">
						<div>
							<label class="mb-1 block text-xs font-medium text-secondary">Name</label>
							<input class="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm" placeholder="Size" bind:value={optionDrafts[i].name} />
						</div>
						<div>
							<label class="mb-1 block text-xs font-medium text-secondary">Arabic name</label>
							<input class="w-full rounded-lg border border-outline-variant px-3 py-2 text-sm" placeholder="المقاس" bind:value={optionDrafts[i].nameAr} />
						</div>
					</div>
					<div class="mt-3 flex flex-wrap items-center gap-4 text-sm">
						<label class="flex items-center gap-1.5 text-on-surface-variant">
							<span>Min</span>
							<input type="number" min="0" class="w-16 rounded-lg border border-outline-variant px-2 py-1" bind:value={optionDrafts[i].minSelections} />
						</label>
						<label class="flex items-center gap-1.5 text-on-surface-variant">
							<span>Max</span>
							<input type="number" min="1" class="w-16 rounded-lg border border-outline-variant px-2 py-1" bind:value={optionDrafts[i].maxSelections} />
						</label>
						<label class="flex items-center gap-1.5 text-on-surface-variant">
							<input type="checkbox" class="h-4 w-4 rounded border-outline-variant" bind:checked={optionDrafts[i].required} />
							<span>Required</span>
						</label>
						<label class="flex items-center gap-1.5 text-on-surface-variant">
							<input type="checkbox" class="h-4 w-4 rounded border-outline-variant" bind:checked={optionDrafts[i].perValueQuantity} />
							<span>Values carry their own inventory</span>
						</label>
					</div>
					<div class="mt-3 space-y-2">
						{#each optionDrafts[i].values as v, j (j)}
							<div class="grid grid-cols-[1fr_1fr_100px_90px_auto] items-center gap-2">
								<input class="w-full rounded-lg border border-outline-variant px-2 py-1.5 text-sm" placeholder="S" bind:value={optionDrafts[i].values[j].value} />
								<input class="w-full rounded-lg border border-outline-variant px-2 py-1.5 text-sm" placeholder="صغير" bind:value={optionDrafts[i].values[j].valueAr} />
								<div class="relative">
									<span class="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-secondary">{product.currency ?? ''}</span>
									<input class="w-full rounded-lg border border-outline-variant py-1.5 pl-8 pr-2 text-sm" type="number" step="0.01" placeholder="Price adj." bind:value={optionDrafts[i].values[j].priceAdjustment} />
								</div>
								{#if optionDrafts[i].perValueQuantity}
									<input class="w-full rounded-lg border border-outline-variant px-2 py-1.5 text-sm" type="number" min="0" placeholder="Qty" bind:value={optionDrafts[i].values[j].quantity} />
								{:else}
									<div class="text-xs text-secondary">—</div>
								{/if}
								<button type="button" class="px-1 text-secondary hover:text-error" onclick={() => removeOptionValue(i, j)}>×</button>
							</div>
						{/each}
						<button type="button" class="text-xs font-medium text-primary hover:underline" onclick={() => addOptionValue(i)}>+ Add value</button>
					</div>
				</div>
			{/each}

			<div class="flex items-center justify-between gap-2">
				<button type="button" class="text-sm font-medium text-primary hover:underline" onclick={addOptionDraft}>+ Add option</button>
				<p class="text-xs text-secondary">After saving, use “Generate variants” to create the combination rows.</p>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (optionsModal = false)}>Cancel</Button>
				<Button type="submit" loading={optSaving}>Save options</Button>
			</div>
		</form>
	</Modal>
{/if}
