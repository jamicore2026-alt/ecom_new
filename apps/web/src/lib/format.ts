export const currency = (n: number | null | undefined, code = 'USD') =>
	new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: code,
		minimumFractionDigits: 2
	}).format(n ?? 0)

export const number = (n: number | null | undefined) =>
	new Intl.NumberFormat('en-US').format(n ?? 0)

export const dateTime = (s: string | null | undefined) => {
	if (!s) return '—'
	const d = new Date(s)
	return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export const dateTimeFull = (s: string | null | undefined) => {
	if (!s) return '—'
	const d = new Date(s)
	return d.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	})
}

export const timeAgo = (s: string | null | undefined) => {
	if (!s) return '—'
	const diff = Date.now() - new Date(s).getTime()
	const mins = Math.floor(diff / 60000)
	if (mins < 1) return 'just now'
	if (mins < 60) return `${mins}m ago`
	const hrs = Math.floor(mins / 60)
	if (hrs < 24) return `${hrs}h ago`
	const days = Math.floor(hrs / 24)
	if (days < 30) return `${days}d ago`
	return dateTime(s)
}

export const initials = (name: string | null | undefined) => {
	if (!name) return '?'
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((p) => p[0]?.toUpperCase())
		.join('')
}

export const titleCase = (s: string) =>
	s
		.split('_')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')

export const pct = (n: number | null | undefined) => `${(n ?? 0).toFixed(1)}%`

export const placeholderImage = () => '/images/placeholder.svg'

export const handleImageError = (e: { currentTarget: EventTarget }) => {
	const img = e.currentTarget as HTMLImageElement
	if (!img || img.dataset.fallback) return
	img.dataset.fallback = '1'
	if (img.src !== placeholderImage()) img.src = placeholderImage()
}
