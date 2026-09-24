-- Phase 4 restaurant: POS tips + cash-drawer shifts.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tip_total" numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "register_shifts" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "outlet_id" varchar(30) REFERENCES "outlets"("id") ON DELETE SET NULL,
  "opened_by" varchar(30) NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
  "open_bank" numeric NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "drops" jsonb NOT NULL DEFAULT '[]',
  "payouts" jsonb NOT NULL DEFAULT '[]',
  "expected_cash" numeric,
  "actual_cash" numeric,
  "closed_by" varchar(30) REFERENCES "users"("id") ON DELETE SET NULL,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "register_shifts_merchant_idx" ON "register_shifts" ("merchant_id");
CREATE INDEX IF NOT EXISTS "register_shifts_outlet_status_idx" ON "register_shifts" ("outlet_id", "status");
