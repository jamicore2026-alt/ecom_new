import { i18n } from '$lib/i18n'

const numLocale = () => (i18n.locale === 'ar' ? 'ar-U' : 'en-US')

export const money = (value: number | null | undefined, currency = 'USD') =>
	new Intl.NumberFormat(numLocale(), {
		style: 'currency',
		currency,
		numberingSystem: 'latn'
	}).format(value ?? 0)

export const inStock = (stock: number, trackInventory: boolean) =>
	!trackInventory || stock > 0

export const placeholderImage = () =>
	'/images/placeholder.svg'

export const handleImageError = (e: { currentTarget: EventTarget }) => {
	const img = e.currentTarget as HTMLImageElement
	if (!img || img.dataset.fallback) return
	img.dataset.fallback = '1'
	if (img.src !== placeholderImage()) img.src = placeholderImage()
}
