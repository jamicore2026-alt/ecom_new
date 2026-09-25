-- Phase 7: store credit, per-line VAT, hold-and-fire, floor coords, reservations.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "store_credit" numeric NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "vat_rate" numeric;
ALTER TABLE "food_order_items" ADD COLUMN IF NOT EXISTS "fire_at" timestamptz;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "pos_x" integer;
ALTER TABLE "tables" ADD COLUMN IF NOT EXISTS "pos_y" integer;
CREATE TABLE IF NOT EXISTS "reservations" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "outlet_id" varchar(30) NOT NULL REFERENCES "outlets"("id") ON DELETE CASCADE,
  "table_id" varchar(30) REFERENCES "tables"("id") ON DELETE SET NULL,
  "guest_name" varchar(120) NOT NULL,
  "guest_phone" varchar(30),
  "party_size" integer NOT NULL DEFAULT 2,
  "reserved_at" timestamptz NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'booked',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "reservations_merchant_outlet_idx" ON "reservations" ("merchant_id", "outlet_id");
CREATE INDEX IF NOT EXISTS "reservations_time_idx" ON "reservations" ("reserved_at");
