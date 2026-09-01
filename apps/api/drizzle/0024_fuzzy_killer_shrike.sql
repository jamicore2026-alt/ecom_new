CREATE TABLE "loyalty_earning_rules" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"trigger" varchar(50) NOT NULL,
	"award_type" varchar(20) DEFAULT 'points' NOT NULL,
	"award_value" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_rewards" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"type" varchar(20) DEFAULT 'product' NOT NULL,
	"points_cost" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"stock" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_tiers" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(50) NOT NULL,
	"min_points" integer DEFAULT 0 NOT NULL,
	"perks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_earning_rules" ADD CONSTRAINT "loyalty_earning_rules_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_tiers" ADD CONSTRAINT "loyalty_tiers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_rules_merchant_idx" ON "loyalty_earning_rules" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "loyalty_rewards_merchant_status_idx" ON "loyalty_rewards" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "loyalty_tiers_merchant_idx" ON "loyalty_tiers" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_merchant_idempotency_unique_idx" ON "refunds" USING btree ("merchant_id","idempotency_key");