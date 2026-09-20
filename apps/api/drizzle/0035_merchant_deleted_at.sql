-- 0035_merchant_deleted_at: soft-delete marker for offboarded merchants.
-- Set by PlatformService when a merchant reaches `archived`. Rows are never
-- hard-deleted; login/API/storefront stay blocked by merchants.status.
-- Fully idempotent.
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
