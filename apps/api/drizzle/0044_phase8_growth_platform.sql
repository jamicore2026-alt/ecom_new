-- Phase 8: coupon scoping, redemptions ledger, review media/replies,
-- campaign tracking tokens, marketing opt-out, staff invites.
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "applies_to" jsonb NOT NULL DEFAULT '{"scope":"all"}';
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "per_customer_limit" integer;
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "first_order_only" boolean NOT NULL DEFAULT false;
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "stackable" boolean NOT NULL DEFAULT true;
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "coupon_id" varchar(30) NOT NULL REFERENCES "coupons"("id") ON DELETE CASCADE,
  "customer_id" varchar(30) REFERENCES "customers"("id") ON DELETE SET NULL,
  "customer_email" varchar(255),
  "order_id" varchar(30) REFERENCES "orders"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "coupon_redemptions_coupon_customer_idx" ON "coupon_redemptions" ("coupon_id", "customer_id");
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "images" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "helpful_count" integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS "review_replies" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "review_id" varchar(30) NOT NULL REFERENCES "reviews"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "created_by" varchar(30) REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "review_replies_review_idx" ON "review_replies" ("review_id");
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "track_token" varchar(64);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "marketing_opt_out" boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "staff_invites" (
  "id" varchar(30) PRIMARY KEY,
  "merchant_id" varchar(30) NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "role_id" varchar(30) REFERENCES "roles"("id") ON DELETE SET NULL,
  "permissions" jsonb NOT NULL DEFAULT '[]',
  "token_hash" varchar(64) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "created_by" varchar(30) REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "staff_invites_merchant_email_idx" ON "staff_invites" ("merchant_id", "email");
CREATE INDEX IF NOT EXISTS "staff_invites_token_idx" ON "staff_invites" ("token_hash");
