export const money = (value: number | null | undefined, currency = 'USD') =>
	new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value ?? 0)

export const inStock = (stock: number, trackInventory: boolean) =>
	!trackInventory || stock > 0

export const placeholderImage = () =>
	'/images/placeholder.svg'
