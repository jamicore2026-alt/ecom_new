<script lang="ts">
	import { onMount } from 'svelte'
	import { api } from '$lib/api'
	import { toast } from '$lib/toast.svelte'
	import { session } from '$lib/session.svelte'
	import Button from '$lib/components/Button.svelte'
	import Card from '$lib/components/Card.svelte'

	const DEFAULTS = {
		primaryColor: '#4f46e5',
		secondaryColor: '#6b7280',
		accentColor: '#f59e0b',
		logo: '',
		typography: {},
		header: {},
		footer: {},
		config: {}
	}

	let primaryColor = $state(DEFAULTS.primaryColor)
	let secondaryColor = $state(DEFAULTS.secondaryColor)
	let accentColor = $state(DEFAULTS.accentColor)
	let logo = $state(DEFAULTS.logo)
	let typographyText = $state('{}')
	let headerText = $state('{}')
	let footerText = $state('{}')
	let configText = $state('{}')
	let saving = $state(false)
	let loading = $state(true)

	const canManage = () => session.can('settings.manage')

	function safeStringify(obj: unknown): string {
		if (!obj || typeof obj !== 'object') return '{}'
		try {
			return JSON.stringify(obj, null, 2)
		} catch {
			return '{}'
		}
	}

	function parseJsonField(text: string, label: string): Record<string, unknown> | null {
		const trimmed = text.trim()
		if (!trimmed) return {}
		try {
			const parsed = JSON.parse(trimmed)
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				toast.error(`${label} must be a JSON object`)
				return null
			}
			return parsed
		} catch {
			toast.error(`${label} contains invalid JSON`)
			return null
		}
	}

	async function load() {
		try {
			const res = await api.get<{ success: boolean; data: Record<string, unknown> }>('/api/theme')
			const d = res.data
			primaryColor = (typeof d.primaryColor === 'string' ? d.primaryColor : DEFAULTS.primaryColor)
			secondaryColor = (typeof d.secondaryColor === 'string' ? d.secondaryColor : DEFAULTS.secondaryColor)
			accentColor = (typeof d.accentColor === 'string' ? d.accentColor : DEFAULTS.accentColor)
			logo = (typeof d.logo === 'string' ? d.logo : '')
			typographyText = safeStringify(d.typography)
			headerText = safeStringify(d.header)
			footerText = safeStringify(d.footer)
			configText = safeStringify(d.config)
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			loading = false
		}
	}

	onMount(load)

	function resetToDefaults() {
		primaryColor = DEFAULTS.primaryColor
		secondaryColor = DEFAULTS.secondaryColor
		accentColor = DEFAULTS.accentColor
		logo = ''
		typographyText = '{}'
		headerText = '{}'
		footerText = '{}'
		configText = '{}'
	}

	async function save() {
		const typography = parseJsonField(typographyText, 'Typography')
		if (typography === null) return
		const header = parseJsonField(headerText, 'Header')
		if (header === null) return
		const footer = parseJsonField(footerText, 'Footer')
		if (footer === null) return
		const config = parseJsonField(configText, 'Config')
		if (config === null) return

		saving = true
		try {
			const body: Record<string, unknown> = {
				primaryColor,
				secondaryColor,
				accentColor,
				logo: logo || null,
				typography,
				header,
				footer,
				config
			}
			await api.put<{ success: boolean }>('/api/theme', body)
			toast.success('Theme saved')
		} catch (e) {
			toast.error((e as Error).message)
		} finally {
			saving = false
		}
	}
</script>

<svelte:head>
	<title>Theme — Merchant OS</title>
</svelte:head>

<div class="space-y-5">
	<div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div>
			<h1 class="font-display text-display text-on-surface">Theme &amp; Branding</h1>
			<p class="mt-1 text-body-sm text-secondary">Customize your storefront colors, logo, and branding.</p>
		</div>
		<Button variant="secondary" size="sm" onclick={resetToDefaults}>Reset to defaults</Button>
	</div>

	{#if loading}
		<div class="space-y-5">
			{#each Array(3) as _}
				<div class="h-40 animate-pulse rounded bg-surface-container"></div>
			{/each}
		</div>
	{:else if !canManage()}
		<div class="rounded border border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
			You need the <span class="font-semibold text-on-surface">settings.manage</span> permission to edit the theme.
		</div>
	{:else}
	<form class="space-y-5" onsubmit={(e) => { e.preventDefault(); save() }}>
		<Card title="Colors" headingLevel="h2">
			<div class="grid gap-4 sm:grid-cols-3">
				{#each [{ label: 'Primary', bind: 'primaryColor' }, { label: 'Secondary', bind: 'secondaryColor' }, { label: 'Accent', bind: 'accentColor' }] as c (c.bind)}
					{@const currentColor = c.bind === 'primaryColor' ? primaryColor : c.bind === 'secondaryColor' ? secondaryColor : accentColor}
					<div>
						<label class="field-label" for={`color-${c.bind}`}>{c.label} color</label>
						<div class="flex items-center gap-3">
							<input
								id={`color-${c.bind}`}
								type="color"
								class="h-10 w-10 cursor-pointer rounded border border-outline-variant"
								value={currentColor}
								oninput={(e) => {
									const v = (e.currentTarget as HTMLInputElement).value
									if (c.bind === 'primaryColor') primaryColor = v
									else if (c.bind === 'secondaryColor') secondaryColor = v
									else accentColor = v
								}}
							/>
							<input
								type="text"
								class="field w-24 uppercase"
								value={currentColor}
								oninput={(e) => {
									const v = (e.currentTarget as HTMLInputElement).value
									if (c.bind === 'primaryColor') primaryColor = v
									else if (c.bind === 'secondaryColor') secondaryColor = v
									else accentColor = v
								}}
								placeholder="#000000"
								maxlength="7"
							/>
							<div
								class="h-10 w-10 shrink-0 rounded border border-outline-variant"
								style="background-color: {currentColor}"
							></div>
						</div>
					</div>
				{/each}
			</div>
		</Card>

		<Card title="Logo" headingLevel="h2">
			<div>
				<label for="theme-logo" class="field-label">Logo URL</label>
				<input id="theme-logo" class="field" bind:value={logo} placeholder="https://example.com/logo.png" />
			</div>
		</Card>

		<Card title="Typography" headingLevel="h2">
			<div>
				<label for="theme-typography" class="field-label">Typography (JSON)</label>
				<textarea id="theme-typography" class="field min-h-[120px] font-mono text-xs" bind:value={typographyText}></textarea>
			</div>
		</Card>

		<Card title="Header" headingLevel="h2">
			<div>
				<label for="theme-header" class="field-label">Header (JSON)</label>
				<textarea id="theme-header" class="field min-h-[120px] font-mono text-xs" bind:value={headerText}></textarea>
			</div>
		</Card>

		<Card title="Footer" headingLevel="h2">
			<div>
				<label for="theme-footer" class="field-label">Footer (JSON)</label>
				<textarea id="theme-footer" class="field min-h-[120px] font-mono text-xs" bind:value={footerText}></textarea>
			</div>
		</Card>

		<Card title="Additional Config" headingLevel="h2">
			<div>
				<label for="theme-config" class="field-label">Config (JSON)</label>
				<textarea id="theme-config" class="field min-h-[120px] font-mono text-xs" bind:value={configText}></textarea>
			</div>
		</Card>

		<div class="flex justify-end">
			<Button type="submit" loading={saving}>Save</Button>
		</div>
	</form>
	{/if}
</div>
