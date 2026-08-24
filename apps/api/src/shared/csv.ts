/**
 * Minimal RFC 4180 CSV utilities (no external deps).
 * Handles quoted fields, escaped quotes ("") and newlines inside quotes.
 */

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  while (i < s.length) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          quoted = false
          i++
        }
      } else {
        field += c
        i++
      }
    } else if (c === '"' && field === '') {
      quoted = true
      i++
    } else if (c === ',') {
      row.push(field)
      field = ''
      i++
    } else if (c === '\r') {
      i++
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else {
      field += c
      i++
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Drop fully-empty lines
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '')
}

export function csvEscape(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  // Neutralize spreadsheet formula injection — a leading =+-@ followed by a
  // letter would otherwise execute as a formula when opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) lines.push(row.map(csvEscape).join(','))
  return `${lines.join('\r\n')}\r\n`
}
