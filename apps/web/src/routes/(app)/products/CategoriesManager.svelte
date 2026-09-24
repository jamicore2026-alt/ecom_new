<script lang="ts">
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import Button from '$lib/components/Button.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import type { Category } from '$lib/types'

	let { categories, onClose, onSaved } = $props<{
		categories: Category[]
		onClose: () => void
		onSaved: () => void
	}>()

	let saving = $state(false)
	let fieldErrors = $state<Record<string, string>>({})

	let name = $state('')
	let nameAr = $state('')
	let slug = $state('')
	let parentId = $state('')
	let sortOrder = $state('0')
	let status = $state('active')
	let image = $state('')
	let description = $state('')
	let editing = $state<Category | null>(null)
	let deleteTarget = $state<Category | null>(null)
	let reassignTo = $state('')

	function startEdit(c: Category) {
		editing = c
		name = c.name
		nameAr = c.nameAr ?? ''
		slug = c.slug ?? ''
		parentId = c.parentId ?? ''
		sortOrder = String(c.sortOrder)
		status = c.status
		image = c.image ?? ''
		description = c.description ?? ''
	}

	function reset() {
		editing = null
		name = ''
		nameAr = ''
		slug = ''
		parentId = ''
		sortOrder = '0'
		status = 'active'
		image = ''
		description = ''
	}

	async function submit() {
		saving = true
		fieldErrors = {}
		try {
			const body: Record<string, unknown> = {
				name,
				nameAr: nameAr === '' ? null : nameAr,
				slug: slug || undefined,
				parentId: parentId || null,
				sortOrder: Number(sortOrder || 0),
				status,
				image: image || null,
				description: description || null
			}
			if (editing) {
				await api.put<{ success: boolean }>(`/api/categories/${editing.id}`, body)
				toast.success('Category updated')
			} else {
				await api.post<{ success: boolean }>('/api/categories', body)
				toast.success('Category created')
			}
			reset()
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

	async function remove(c: Category) {
		deleteTarget = c
		reassignTo = ''
	}

	async function confirmDelete() {
		if (!deleteTarget) return
		try {
			const path = reassignTo
				? `/api/categories/${deleteTarget.id}?reassignTo=${encodeURIComponent(reassignTo)}`
				: `/api/categories/${deleteTarget.id}`
			await api.delete<{ success: boolean }>(path)
			toast.success(
				reassignTo ? 'Category deleted — products moved' : 'Category deleted — products uncategorized'
			)
			deleteTarget = null
			onSaved()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

	function flatten(list: Category[], depth = 0): Array<Category & { depth: number }> {
		return list.flatMap((c) => [{ ...c, depth }, ...flatten(c.children ?? [], depth + 1)])
	}
</script>

<Modal title="Categories" open={true} width="md" onClose={onClose}>
	<div class="space-y-5">
		<form
			class="space-y-3 rounded border border-outline-variant bg-surface-container-low p-4"
			onsubmit={(e) => {
				e.preventDefault()
				submit()
			}}
		>
			<h3 class="text-sm font-semibold text-on-surface">{editing ? 'Edit category' : 'New category'}</h3>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label for="cat-name" class="field-label">Name *</label>
					<input id="cat-name" class="field" bind:value={name} required />
					{#if fieldErrors.name}<p class="field-error">{fieldErrors.name}</p>{/if}
				</div>
				<div>
					<label for="cat-name-ar" class="field-label">Name (Arabic)</label>
					<input id="cat-name-ar" class="field" bind:value={nameAr} dir="rtl" />
				</div>
				<div>
					<label for="cat-slug" class="field-label">Slug</label>
					<input id="cat-slug" class="field" bind:value={slug} placeholder="Auto-generated from name" />
				</div>
				<div>
					<label for="cat-image" class="field-label">Image URL</label>
					<input id="cat-image" class="field" bind:value={image} placeholder="https://…" />
				</div>
				<div class="sm:col-span-2">
					<label for="cat-description" class="field-label">Description</label>
					<textarea id="cat-description" rows="2" class="field" bind:value={description}></textarea>
				</div>
				<div>
					<label for="cat-parent" class="field-label">Parent</label>
					<select id="cat-parent" class="field" bind:value={parentId}>
						<option value="">None (top level)</option>
						{#each flatten(categories) as c (c.id)}
							{#if c.id !== editing?.id}
								<option value={c.id}>{'—'.repeat(c.depth + 1)} {c.name}</option>
							{/if}
						{/each}
					</select>
				</div>
				<div>
					<label for="cat-sort-order" class="field-label">Sort order</label>
					<input id="cat-sort-order" type="number" class="field" bind:value={sortOrder} />
				</div>
				<div>
					<label for="cat-status" class="field-label">Status</label>
					<select id="cat-status" class="field" bind:value={status}>
						<option value="active">Active</option>
						<option value="archived">Archived</option>
					</select>
				</div>
			</div>
			<div class="flex items-center justify-between">
				<button type="button" class="text-xs font-medium text-secondary hover:text-on-surface" onclick={reset}>
					Clear form
				</button>
				<div class="flex gap-2">
					<Button variant="secondary" type="button" onclick={reset}>Reset</Button>
					<Button type="submit" loading={saving}>{editing ? 'Save' : 'Create'}</Button>
				</div>
			</div>
		</form>

		<ul class="space-y-1">
			{#each flatten(categories) as c (c.id)}
				<li class="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-3 py-2" style="margin-left:{c.depth * 12}px">
					<Icon name="folder" size="text-[16px]" class="shrink-0 text-secondary" />
					<span class="min-w-0 flex-1 truncate text-sm text-on-surface-variant">
						<span class="font-medium text-on-surface">{c.name}</span>
						{#if c.nameAr}
							<span class="ml-1 text-xs text-secondary" dir="auto">· {c.nameAr}</span>
						{/if}
						{#if c.status !== 'active'}
							<span class="ml-1 text-xs text-outline">({c.status})</span>
						{/if}
					</span>
					<button class="rounded p-1.5 text-xs font-medium text-primary hover:bg-primary-fixed-dim/40" onclick={() => startEdit(c)}>Edit</button>
					<button class="rounded p-1.5 text-xs font-medium text-error hover:bg-error-container/40" onclick={() => remove(c)}>Delete</button>
				</li>
			{/each}
			{#if categories.length === 0}
				<li class="rounded border border-dashed border-outline-variant p-4 text-center text-sm text-secondary">
					No categories yet.
				</li>
			{/if}
		</ul>
	</div>
</Modal>

{#if deleteTarget}
	<Modal title={`Delete "${deleteTarget.name}"?`} open={true} width="sm" onClose={() => (deleteTarget = null)}>
		<div class="space-y-4">
			<p class="text-sm text-secondary">Move its products to another category, or leave them uncategorized.</p>
			<div>
				<label for="cat-reassign" class="field-label">Reassign products to</label>
				<select id="cat-reassign" class="field" bind:value={reassignTo}>
					<option value="">None (uncategorized)</option>
					{#each flatten(categories) as c (c.id)}
						{#if c.id !== deleteTarget.id}
							<option value={c.id}>{'—'.repeat(c.depth + 1)} {c.name}</option>
						{/if}
					{/each}
				</select>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="secondary" onclick={() => (deleteTarget = null)}>Cancel</Button>
				<Button onclick={confirmDelete}>Delete category</Button>
			</div>
		</div>
	</Modal>
{/if}