ALTER TABLE "customers" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_code" varchar(100);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "attribution_channel" varchar(20);