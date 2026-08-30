CREATE UNIQUE INDEX IF NOT EXISTS "refunds_merchant_idempotency_unique_idx"
ON "refunds" USING btree ("merchant_id", "idempotency_key")
WHERE "idempotency_key" IS NOT NULL;
