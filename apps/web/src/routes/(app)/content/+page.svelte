<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import Modal from '$lib/components/Modal.svelte'
	import Badge from '$lib/components/Badge.svelte'
	import { dateTime } from '$lib/format'

	interface ContentPage {
		id: string
		merchantId: string
		title: string
		slug: string
		content: string
		status: 'draft' | 'published' | 'archived'
		metaTitle: string | null
		metaDescription: string | null
		publishedAt: string | null
		createdAt: string
		updatedAt: string
	}

	let pages = $state<ContentPage[]>([])
	let loading = $state(true)
	let saving = $state(false)

	let showModal = $state(false)
	let editing = $state<ContentPage | null>(null)
	let showView = $state(false)
	let viewing = $state<ContentPage | null>(null)

	let formTitle = $state('')
	let formSlug = $state('')
	let formContent = $state('')
	let formStatus = $state<'draft' | 'published' | 'archived'>('draft')
	let formMetaTitle = $state('')
	let formMetaDescription = $state('')

	const canManage = () => session.can('settings.manage')

	async function load() {
		loading = true
		try {
			const res = await api.get<{ success: boolean; data: { items: ContentPage[] } }>('/api/content')
			pages = res.data.items
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function openCreate() {
		editing = null
		formTitle = ''
		formSlug = ''
		formContent = ''
		formStatus = 'draft'
		formMetaTitle = ''
		formMetaDescription = ''
		showModal = true
	}

	function openEdit(page: ContentPage) {
		editing = page
		formTitle = page.title
		formSlug = page.slug
		formContent = page.content
		formStatus = page.status
		formMetaTitle = page.metaTitle ?? ''
		formMetaDescription = page.metaDescription ?? ''
		showModal = true
	}

	function openView(page: ContentPage) {
		viewing = page
		showView = true
	}

	function slugify(text: string) {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
	}

	function onTitleInput() {
		if (!editing) {
			formSlug = slugify(formTitle)
		}
	}

	async function savePage() {
		if (!formTitle.trim()) {
			toast.error('Title is required')
			return
		}
		saving = true
		try {
			if (editing) {
				await api.put(`/api/content/${editing.id}`, {
					title: formTitle.trim(),
					slug: formSlug.trim(),
					content: formContent,
					status: formStatus,
					metaTitle: formMetaTitle.trim() || null,
					metaDescription: formMetaDescription.trim() || null
				})
				toast.success('Page updated')
			} else {
				await api.post('/api/content', {
					title: formTitle.trim(),
					slug: formSlug.trim() || slugify(formTitle.trim()),
					content: formContent,
					status: formStatus
				})
				toast.success('Page created')
			}
			showModal = false
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}

	async function deletePage(page: ContentPage) {
		if (!confirm(`Delete page "${page.title}"?`)) return
		try {
			await api.delete(`/api/content/${page.id}`)
			toast.success('Page deleted')
			await load()
		} catch (e) {
			toast.error((e as Error).message)
		}
	}

</script>

<svelte:head>
	<title>Content Pages — Merchant OS</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Content Pages</h1>
			<p class="mt-1 text-body-sm text-secondary">Manage your storefront pages and content.</p>
		</div>
		{#if canManage()}
			<Button size="sm" onclick={openCreate}><Icon name="add" size="text-[16px]" /> New page</Button>
		{/if}
	</div>

	{#if loading}
		<div class="space-y-2 p-5">
			{#each Array(6) as _}
				<div class="h-12 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else}
		<Card padded={false}>
			<ul class="divide-y divide-outline-variant/60">
				{#each pages as page (page.id)}
					<li class="flex items-center justify-between gap-4 px-4 py-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="font-mono-label text-mono-label text-on-surface">{page.title}</span>
								<Badge label={page.status} />
							</div>
							<p class="mt-0.5 text-xs text-secondary font-mono">/{page.slug}</p>
						</div>
						<div class="flex items-center gap-2 text-xs text-secondary shrink-0">
							<span>{dateTime(page.updatedAt)}</span>
							{#if canManage()}
								<button class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => openView(page)} aria-label="View page"><Icon name="visibility" size="text-[18px]" /></button>
								<button class="rounded p-1.5 text-secondary hover:bg-surface-container hover:text-on-surface" onclick={() => openEdit(page)} aria-label="Edit page"><Icon name="edit" size="text-[18px]" /></button>
								<button class="rounded p-1.5 text-secondary hover:bg-error/10 hover:text-error" onclick={() => deletePage(page)} aria-label="Delete page"><Icon name="delete" size="text-[18px]" /></button>
							{/if}
						</div>
					</li>
			{:else}
				<li class="flex flex-col items-center gap-2 px-4 py-12 text-center">
					<Icon name="article" size="text-[32px]" class="text-outline" />
					<p class="text-sm text-secondary">No content pages yet.</p>
				</li>
				{/each}
			</ul>
		</Card>
	{/if}
</div>

{#if showModal}
	<Modal title={editing ? 'Edit page' : 'New page'} open={true} onClose={() => (showModal = false)} width="lg">
		<div class="space-y-4">
			<div>
				<label class="field-label" for="page-title">Title</label>
				<input id="page-title" class="field" bind:value={formTitle} oninput={onTitleInput} placeholder="Page title" />
			</div>
			<div>
				<label class="field-label" for="page-slug">Slug</label>
				<input id="page-slug" class="field font-mono" bind:value={formSlug} placeholder="page-slug" />
			</div>
			<div>
				<label class="field-label" for="page-content">Content</label>
				<textarea id="page-content" class="field min-h-[200px]" bind:value={formContent} placeholder="Write your page content here..."></textarea>
			</div>
			<div>
				<label class="field-label" for="page-status">Status</label>
				<select id="page-status" class="field" bind:value={formStatus}>
					<option value="draft">Draft</option>
					<option value="published">Published</option>
					<option value="archived">Archived</option>
				</select>
			</div>
			<div>
				<label class="field-label" for="page-meta-title">Meta title</label>
				<input id="page-meta-title" class="field" bind:value={formMetaTitle} placeholder="SEO title (optional)" />
			</div>
			<div>
				<label class="field-label" for="page-meta-desc">Meta description</label>
				<input id="page-meta-desc" class="field" bind:value={formMetaDescription} placeholder="SEO description (optional)" />
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="secondary" size="sm" onclick={() => (showModal = false)}>Cancel</Button>
				<Button size="sm" onclick={savePage} loading={saving}>{editing ? 'Save changes' : 'Create page'}</Button>
			</div>
		</div>
	</Modal>
{/if}

{#if showView && viewing}
	<Modal title={viewing.title} open={true} onClose={() => (showView = false)} width="lg">
		<div class="space-y-4">
			<div class="flex items-center gap-2">
				<span class="text-xs text-secondary font-mono">/{viewing.slug}</span>
				<Badge label={viewing.status} />
			</div>
			<div class="prose prose-sm max-w-none whitespace-pre-wrap text-on-surface-variant">{viewing.content || 'No content.'}</div>
			{#if viewing.metaTitle || viewing.metaDescription}
				<div class="rounded border border-outline-variant bg-surface-container-low p-3 text-xs text-secondary space-y-1">
					{#if viewing.metaTitle}<p><strong>Meta title:</strong> {viewing.metaTitle}</p>{/if}
					{#if viewing.metaDescription}<p><strong>Meta description:</strong> {viewing.metaDescription}</p>{/if}
				</div>
			{/if}
			<div class="flex justify-end">
				<Button variant="secondary" size="sm" onclick={() => (showView = false)}>Close</Button>
			</div>
		</div>
	</Modal>
{/if}
