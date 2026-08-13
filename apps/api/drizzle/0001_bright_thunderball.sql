CREATE TABLE "token_blacklist" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"user_id" varchar(30) NOT NULL,
	"jti" varchar(60) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "value" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "min_subtotal" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "total_spent" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "price" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "total" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "subtotal" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "shipping_total" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "discount_total" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "tax_total" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "total" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "price" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "compare_at_price" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "compare_at_price" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "cost" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "discount_percent" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "returns" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "shipping_settings" ALTER COLUMN "free_shipping_threshold" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "token_blacklist" ADD CONSTRAINT "token_blacklist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "token_blacklist_jti_idx" ON "token_blacklist" USING btree ("jti");--> statement-breakpoint
CREATE INDEX "token_blacklist_user_idx" ON "token_blacklist" USING btree ("user_id");