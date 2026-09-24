-- Phase 6 inventory: stocktake sessions.
CREATE TABLE IF NOT EXISTS "stocktake_sessions" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "warehouse_id" varchar(30) REFERENCES "warehouses"("id") ON DELETE SET NULL,
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_by" varchar(30) REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_by" varchar(30) REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "approved_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "stocktake_merchant_idx" ON "stocktake_sessions" ("merchant_id");
CREATE TABLE IF NOT EXISTS "stocktake_items" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "session_id" varchar(30) NOT NULL REFERENCES "stocktake_sessions"("id") ON DELETE CASCADE,
  "variant_id" varchar(30) NOT NULL REFERENCES "product_variants"("id") ON DELETE CASCADE,
  "system_quantity" integer NOT NULL DEFAULT 0,
  "counted_quantity" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "stocktake_session_variant_idx" ON "stocktake_items" ("session_id", "variant_id");
CREATE INDEX IF NOT EXISTS "stocktake_items_session_idx" ON "stocktake_items" ("session_id");
