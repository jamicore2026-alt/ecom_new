export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

function readStored(): ThemeMode {
	if (typeof document === 'undefined') return 'system'
	const v = localStorage.getItem(STORAGE_KEY)
	return v === 'light' || v === 'dark' ? v : 'system'
}

export function applyTheme(mode: ThemeMode) {
	if (typeof document === 'undefined') return
	const dark =
		mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
	document.documentElement.dataset.theme = dark ? 'dark' : 'light'
	document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

let mode: ThemeMode = $state('system')

export function setTheme(next: ThemeMode) {
	mode = next
	if (typeof document !== 'undefined') localStorage.setItem(STORAGE_KEY, next)
	applyTheme(next)
}

export function initTheme() {
	mode = readStored()
	applyTheme(mode)
	const media = window.matchMedia('(prefers-color-scheme: dark)')
	media.addEventListener('change', () => {
		if (mode === 'system') applyTheme('system')
	})
}

export const theme = {
	get mode() {
		return mode
	},
	get isDark() {
		if (mode === 'dark') return true
		if (mode === 'light') return false
		if (typeof window === 'undefined') return false
		return window.matchMedia('(prefers-color-scheme: dark)').matches
	},
	setTheme,
	initTheme
}