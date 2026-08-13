type ToastType = 'success' | 'error'

let toasts: Array<{ id: number; message: string; type: ToastType }> = $state([])
let nextId = 1

function push(message: string, type: ToastType) {
	const id = nextId++
	toasts = [...toasts, { id, message, type }]
	setTimeout(() => {
		toasts = toasts.filter((t) => t.id !== id)
	}, 4000)
}

export const toast = {
	get items() {
		return toasts
	},
	success: (m: string) => push(m, 'success'),
	error: (m: string) => push(m, 'error')
}
