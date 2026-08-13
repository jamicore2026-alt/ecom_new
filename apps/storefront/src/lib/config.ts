const envDefaultStore = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
	?.PUBLIC_DEFAULT_STORE

export const defaultStoreSlug = envDefaultStore || 'acme-store'
