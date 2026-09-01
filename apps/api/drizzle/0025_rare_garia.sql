ALTER TABLE "orders" ADD COLUMN "idempotency_key" varchar(80);--> statement-breakpoint
CREATE INDEX "orders_idempotency_idx" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_merchant_idempotency_unique_idx" ON "orders" USING btree ("merchant_id","idempotency_key") WHERE "orders"."idempotency_key" IS NOT NULL;--> statement-breakpoint