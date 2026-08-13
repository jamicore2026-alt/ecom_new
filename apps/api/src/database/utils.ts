import { Kind, type TObject } from '@sinclair/typebox'
import { createInsertSchema, createSelectSchema } from 'drizzle-typebox'
import type { Table } from 'drizzle-orm'

type Spread<T extends TObject | Table, Mode extends 'select' | 'insert' | undefined> =
  T extends TObject
    ? Record<string, unknown>
    : T extends Table
      ? Mode extends 'select'
        ? ReturnType<typeof createSelectSchema<T>>
        : Mode extends 'insert'
          ? ReturnType<typeof createInsertSchema<T>>
          : Record<string, unknown>
      : Record<string, unknown>

export const spread = <T extends TObject | Table, Mode extends 'select' | 'insert' | undefined>(
  schema: T,
  mode?: Mode
): Spread<T, Mode> => {
  const newSchema: Record<string, unknown> = {}
  let tableSchema: TObject

  if (Kind in schema) {
    tableSchema = schema as TObject
  } else if (mode === 'insert') {
    tableSchema = createInsertSchema(schema as Table)
  } else if (mode === 'select') {
    tableSchema = createSelectSchema(schema as Table)
  } else {
    throw new Error('Expected a TypeBox schema, or a table with mode "insert" | "select"')
  }

  for (const key of Object.keys(tableSchema.properties)) newSchema[key] = tableSchema.properties[key]

  return newSchema as Spread<T, Mode>
}

export const spreads = <
  T extends Record<string, TObject | Table>,
  Mode extends 'select' | 'insert' | undefined
>(
  models: T,
  mode?: Mode
): { [K in keyof T]: Spread<T[K], Mode> } => {
  const newSchema: Record<string, unknown> = {}
  const keys = Object.keys(models)
  for (const key of keys) newSchema[key] = spread(models[key], mode)
  return newSchema as { [K in keyof T]: Spread<T[K], Mode> }
}
