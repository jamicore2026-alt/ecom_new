#!/usr/bin/env bun
/**
 * Tenant-scope inventory (SaaS audit, P0 work item #1).
 *
 * Parses the drizzle schema and classifies every table by tenant scope:
 *   - Platform   : no merchant ownership (plans, platform config, system)
 *   - Merchant   : merchantId-owned (incl. child tables owned via a parent)
 *   - Outlet     : merchantId + outletId (operational unit partition)
 *   - User       : merchantId + userId (employee-scoped identity)
 *   - Customer   : merchantId + customerId (shopper identity)
 *
 * Usage: bun scripts/tenant-scope-inventory.ts [--md]
 */
import { readFileSync } from 'node:fs'

const schemaPath = new URL('../src/database/schema.ts', import.meta.url).pathname
const original = readFileSync(schemaPath, 'utf8')

/**
 * Blank out comments (and their contents, including quotes/backticks/braces)
 * with spaces, preserving length and newlines so indices still map 1:1 to the
 * original source. Quoted strings / templates are left intact for the lexer.
 */
const maskComments = (src: string): string => {
  const out = src.split('')
  let inString: string | null = null
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (inString) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === inString) inString = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      inString = c
      continue
    }
    if (c === '/' && out[i + 1] === '*') {
      let j = i
      while (j < out.length - 1 && !(out[j] === '*' && out[j + 1] === '/')) {
        if (out[j] !== '\n') out[j] = ' '
        j++
      }
      if (j < out.length) out[j] = ' '
      if (j + 1 < out.length) out[j + 1] = ' '
      i = j + 1
    } else if (c === '/' && out[i + 1] === '/') {
      while (i < out.length && out[i] !== '\n') {
        out[i] = ' '
        i++
      }
    }
  }
  return out.join('')
}

const source = maskComments(original)

interface InventoryRow {
  table: string
  column: string
  scope: 'Platform' | 'Merchant' | 'Outlet' | 'User' | 'Customer'
  merchantId: boolean
  outletId: boolean
  userId: boolean
  customerId: boolean
  line: number
  body: string
  /** Parent table var when merchant scope is inherited via a child FK. */
  inheritedFrom: string | null
}

const KEY_RULES: {
  key: string
  scope: InventoryRow['scope']
}[] = [
  { key: 'outletId', scope: 'Outlet' },
  { key: 'userId', scope: 'User' },
  { key: 'customerId', scope: 'Customer' }
]

const KEY_ORDER = ['merchantId', 'outletId', 'userId', 'customerId'] as const

/** Slice the top-level column-object body of a pgTable(...) call. */
const columnObjectOf = (source: string, callStart: number): { body: string; line: number } | null => {
  let i = callStart + 'pgTable'.length
  while (i < source.length && source[i] !== '{') {
    if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      const q = source[i]
      i++
      while (i < source.length && source[i] !== q) {
        if (source[i] === '\\') i++
        i++
      }
    }
    i++
  }
  if (source[i] !== '{') return null
  const open = i
  let depth = 0
  let j = i
  for (; j < source.length; j++) {
    const c = source[j]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      j++
      while (j < source.length && source[j] !== q) {
        if (source[j] === '\\') j++
        j++
      }
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) break
    }
  }
  const line = source.slice(0, open).split('\n').length
  return { body: source.slice(open + 1, j), line }
}

const rows: InventoryRow[] = []
const seen = new Set<string>()

for (const m of source.matchAll(/export const (\w+) = pgTable\(/g)) {
  const callStart = m.index
  const tableName =
    source.slice(callStart, callStart + 64).match(/pgTable\(\s*'([^']+)'/)?.[1] ?? m[1]
  const key = `${tableName}|${m[1]}`
  if (seen.has(key)) continue
  seen.add(key)

  const obj = columnObjectOf(source, callStart)
  const body = obj?.body ?? ''
  const has = (k: string) => new RegExp(`\\b${k}\\s*:`).test(body)
  const names = {
    merchantId: body.includes('merchantIdRef()') || has('merchantId'),
    outletId: has('outletId'),
    userId: has('userId'),
    customerId: has('customerId')
  }

  const rule = KEY_RULES.find((r) => names[r.key as keyof typeof names])
  const scope: InventoryRow['scope'] = rule
    ? rule.scope
    : names.merchantId
      ? 'Merchant'
      : 'Platform'

  rows.push({ table: tableName, column: m[1], scope, ...names, line: obj?.line ?? 0, body, inheritedFrom: null })
}

// Second pass: child tables without their own tenant key inherit the most
// specific parent scope across their FK parents (order_items -> orders Outlet
// + products Merchant => Outlet; goods_receipt_items -> both Merchant).
const byVar = new Map(rows.map((r) => [r.column, r]))
const EXPLICIT_PLATFORM = new Set(['merchants', 'webhook_events'])
const SPECIFICITY: Record<InventoryRow['scope'], number> = {
  Platform: 5,
  Merchant: 4,
  User: 3,
  Customer: 2,
  Outlet: 1
}
for (let stable = false; !stable; ) {
  stable = true
  for (const row of rows) {
    if (row.scope !== 'Platform' || EXPLICIT_PLATFORM.has(row.table)) continue
    const targets = [...row.body.matchAll(/references\(\(\)\s*=>\s*(\w+)\.id/g)].map((m) => m[1])
    const refs = [...new Set(targets)]
      .map((v) => byVar.get(v))
      .filter((p): p is InventoryRow => !!p && p !== row && p.scope !== 'Platform')
    if (refs.length === 0) continue
    const best = refs.reduce((a, b) =>
      SPECIFICITY[a.scope] < SPECIFICITY[b.scope] ? a : b
    )
    row.scope = best.scope
    row.inheritedFrom = refs.map((r) => r.table).join('+')
    stable = false
  }
}

rows.sort((a, b) => a.scope.localeCompare(b.scope) || a.table.localeCompare(b.table))

const count = (s: InventoryRow['scope']) => rows.filter((r) => r.scope === s).length

if (process.argv.includes('--md')) {
  const byScope = (s: InventoryRow['scope']) =>
    rows
      .filter((r) => r.scope === s)
      .map((r) => {
        const keys = KEY_ORDER.filter((k) => r[k]).join(', ') || '-'
        const parent = r.inheritedFrom ? ` (via ${r.inheritedFrom})` : ''
        return `| \`${r.table}\`${parent} | ${r.column} | ${r.line} | ${keys} |`
      })
      .join('\n')

  for (const s of ['Platform', 'Merchant', 'Outlet', 'User', 'Customer'] as const) {
    if (count(s) === 0) continue
    console.log(`**${s} (${count(s)})**\n`)
    console.log('| Table | Schema var | Line | Scope keys |')
    console.log('|---|---|---|---|')
    console.log(byScope(s), '\n')
  }
  console.log(`_Total: ${rows.length} tables_`)
} else {
  console.log('SCOPE     | TABLE             | VAR                  | LINE | KEYS')
  console.log('----------+-------------------+----------------------+------+-----')
  for (const r of rows) {
    const keys = KEY_ORDER.filter((k) => r[k]).join(' ') || '-'
    const parent = r.inheritedFrom ? ` <- ${r.inheritedFrom}` : ''
    console.log(
      `${r.scope.padEnd(9)} | ${(r.table + parent).padEnd(18)} | ${r.column.padEnd(21)} | ${String(r.line).padEnd(4)} | ${keys}`
    )
  }
  const inherited = rows.filter((r) => r.inheritedFrom).length
  console.log(
    `\n${rows.length} tables: Platform ${count('Platform')}, Merchant ${count('Merchant')} (${inherited} via parent), ` +
      `Outlet ${count('Outlet')}, User ${count('User')}, Customer ${count('Customer')}`
  )
}