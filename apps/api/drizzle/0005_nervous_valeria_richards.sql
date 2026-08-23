CREATE TABLE "email_logs" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"order_id" varchar(30),
	"to_email" varchar(255) NOT NULL,
	"template" varchar(50) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"provider_ref" varchar(255),
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"merchant_id" varchar(30) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"from_name" varchar(255),
	"from_email" varchar(255),
	"templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_logs_merchant_idx" ON "email_logs" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "email_logs_order_idx" ON "email_logs" USING btree ("order_id");