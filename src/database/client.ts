import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ecom_merchant'

export const connection = postgres(DATABASE_URL, { max: 10 })

export const db = drizzle(connection, { schema })

export type DB = typeof db
