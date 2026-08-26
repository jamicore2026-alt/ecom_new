ALTER TABLE "orders" ADD COLUMN "promotion_id" varchar(30);--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "buy_qty" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "get_qty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "usage_limit" integer;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "used_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "idempotency_key" varchar(80);--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "attempt_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_idempotency_idx" ON "refunds" USING btree ("idempotency_key");