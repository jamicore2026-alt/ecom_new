export interface Pagination {
  page: number
  limit: number
  offset: number
}

export interface Meta {
  page: number
  limit: number
  total: number
  totalPages: number
}

const toInt = (v: string | number | undefined, fallback: number, min: number, max: number) => {
  const n = Math.floor(Number(v ?? fallback))
  if (!Number.isFinite(n) || n < min) return min
  return Math.min(n, max)
}

export const parsePagination = (query: { page?: string | number; limit?: string | number }): Pagination => {
  const page = toInt(query.page, 1, 1, 1_000_000)
  const limit = toInt(query.limit, 20, 1, 100)
  return { page, limit, offset: (page - 1) * limit }
}

export const makeMeta = (page: number, limit: number, total: number): Meta => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit))
})

export const parseSearch = (search?: string) => search?.trim() ?? undefined
