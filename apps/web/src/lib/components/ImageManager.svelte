<script lang="ts">
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import type { ProductImage } from '$lib/types'

	let {
		images = $bindable([]),
		disabled = false
	}: { images?: ProductImage[]; disabled?: boolean } = $props()

	let uploading = $state(false)
	let fileInput: HTMLInputElement | null = $state(null)

	async function handleFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement
		const files = input.files
		if (!files || files.length === 0) return
		uploading = true
		try {
			const form = new FormData()
			for (const f of files) form.append('files', f)
			const res = await api.upload<{ success: boolean; data: Array<{ url: string }> }>(
				'/api/uploads',
				form
			)
			for (const stored of res.data) {
				images.push({
					id: stored.url,
					productId: '',
					url: stored.url,
					altText: '',
					sortOrder: images.length,
					createdAt: ''
				})
			}
			toast.success(`${res.data.length} image${res.data.length === 1 ? '' : 's'} added`)
		} catch (e) {
			toast.error((e as Error).message ?? 'Upload failed')
		} finally {
			uploading = false
			input.value = ''
		}
	}

	function remove(index: number) {
		images.splice(index, 1)
	}

	function move(index: number, delta: -1 | 1) {
		const target = index + delta
		if (target < 0 || target >= images.length) return
		const [item] = images.splice(index, 1)
		images.splice(target, 0, item)
	}
</script>

<div class="space-y-3">
	<div class="flex flex-wrap gap-3">
		{#each images as img, i (img.url + String(i))}
			<div class="group relative w-24">
				<div class="h-24 w-24 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
					<img src={img.url} alt={img.altText ?? ''} class="h-full w-full object-cover" />
					{#if i === 0}
						<span class="absolute top-1 left-1 rounded bg-gray-900/80 px-1.5 py-0.5 text-[10px] font-medium text-white">Cover</span>
					{/if}
				</div>
				<input
					class="mt-1 w-24 rounded border border-gray-200 px-1.5 py-1 text-xs"
					placeholder="Alt text"
					maxlength="255"
					bind:value={img.altText}
					disabled={disabled}
				/>
				{#if !disabled}
					<button
						type="button"
						class="absolute -top-2 -right-2 hidden h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white group-hover:flex"
						onclick={() => remove(i)}
						aria-label="Remove image"
					>×</button>
					<div class="mt-1 flex w-24 justify-center gap-1">
						<button type="button" class="rounded border border-gray-200 px-1.5 text-xs disabled:opacity-30" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move left">←</button>
						<button type="button" class="rounded border border-gray-200 px-1.5 text-xs disabled:opacity-30" onclick={() => move(i, 1)} disabled={i === images.length - 1} aria-label="Move right">→</button>
					</div>
				{/if}
			</div>
		{/each}

		{#if !disabled}
			<button
				type="button"
				class="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50"
				onclick={() => fileInput?.click()}
				disabled={uploading}
			>
				<span class="text-xl leading-none">{uploading ? '…' : '+'}</span>
				<span class="text-[10px]">Add image</span>
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept="image/jpeg,image/png,image/webp,image/gif"
				multiple
				class="hidden"
				onchange={handleFiles}
			/>
		{/if}
	</div>
	<p class="text-xs text-gray-400">JPEG / PNG / WebP / GIF · up to 5MB each · first image is the cover</p>
</div>
