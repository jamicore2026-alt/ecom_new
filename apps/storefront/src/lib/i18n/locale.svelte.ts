import { en } from './dictionaries/en'
import { ar } from './dictionaries/ar'

export type Locale = 'en' | 'ar'
export type Dict = Record<string, string>

export const LOCALE_COOKIE = 'locale'

const dictionaries: Record<Locale, Dict> = { en, ar }

export const SUPPORTED_LOCALES: Locale[] = ['en', 'ar']

export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'ar'

export function readLocale(): Locale {
	if (typeof document === 'undefined') return 'en'
	const m = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/)
	if (m && isLocale(m[1])) return m[1]
	if (isLocale(navigator.language)) return navigator.language
	return 'en'
}

export function setDocumentLocale(locale: Locale) {
	if (typeof document === 'undefined') return
	document.documentElement.lang = locale
	document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
}

let locale: Locale = $state('en')

export function setLocale(next: Locale) {
	if (!isLocale(next)) next = 'en'
	if (locale === next) return
	locale = next
	document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`
	setDocumentLocale(locale)
}

export function initLocale(initial?: Locale) {
	locale = isLocale(initial) ? initial : readLocale()
	setDocumentLocale(locale)
}

type Params = Record<string, string | number>

/**
 * Translate a key against the active locale dictionary, falling back to the
 * English entry (and finally the raw key) so untranslated strings never crash.
 */
export function t(key: string, params?: Params): string {
	const dict = dictionaries[locale]
	let str = dict[key] ?? en[key] ?? key
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			str = str.replaceAll(`{${k}}`, String(v))
		}
	}
	return str
}

export const i18n = {
	get locale() {
		return locale
	},
	get isRtl() {
		return locale === 'ar'
	},
	setLocale,
	initLocale,
	t
}

/**
 * Bilingual-field picker (Mnasati pattern): an Arabic value is used whenever
 * the active locale is Arabic and the merchant supplied one, otherwise the
 * primary-language value wins.
 */
export function localized(label: string, labelAr?: string | null): string {
	return locale === 'ar' && labelAr ? labelAr : label
}

/** Option-value label for a variant row, honoring per-option Arabic values. */
export function localizedOptionValue(
	optionValues: Record<string, string>,
	optionValuesAr: Record<string, string>,
	name: string
): string {
	const primary = optionValues[name] ?? ''
	return locale === 'ar' && optionValuesAr[name] ? optionValuesAr[name] : primary
}

/** Grouped options (option name → choices) for the variant chooser, with
 *  localized names and values. */
export function optionGroups(variants: Array<{ optionValues: Record<string, string>; optionValuesAr: Record<string, string> }>) {
	const names = [...new Set(variants.flatMap((v) => Object.keys(v.optionValues)))]
	return names.map((name) => ({
		name,
		label: localized(name),
		values: [...new Set(variants.map((v) => v.optionValues[name]).filter((v): v is string => Boolean(v)))]
	}))
}