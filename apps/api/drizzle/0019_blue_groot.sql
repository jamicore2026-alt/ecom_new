CREATE TABLE "table_sections" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30) NOT NULL,
	"name" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_sessions" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30) NOT NULL,
	"table_id" varchar(30),
	"status" varchar(20) DEFAULT 'OPEN' NOT NULL,
	"guests" integer DEFAULT 1 NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30) NOT NULL,
	"section_id" varchar(30),
	"name" varchar(60) NOT NULL,
	"code" varchar(30) NOT NULL,
	"seats" integer DEFAULT 2 NOT NULL,
	"status" varchar(20) DEFAULT 'AVAILABLE' NOT NULL,
	"qr_token" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "table_session_id" varchar(30);--> statement-breakpoint
ALTER TABLE "table_sections" ADD CONSTRAINT "table_sections_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sections" ADD CONSTRAINT "table_sections_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_section_id_table_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."table_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "table_sections_merchant_outlet_name_idx" ON "table_sections" USING btree ("merchant_id","outlet_id","name");--> statement-breakpoint
CREATE INDEX "table_sections_merchant_idx" ON "table_sections" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "table_sessions_merchant_status_idx" ON "table_sessions" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "table_sessions_table_idx" ON "table_sessions" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "table_sessions_merchant_idx" ON "table_sessions" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tables_merchant_outlet_code_idx" ON "tables" USING btree ("merchant_id","outlet_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "tables_qr_token_idx" ON "tables" USING btree ("qr_token");--> statement-breakpoint
CREATE INDEX "tables_merchant_idx" ON "tables" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "tables_section_idx" ON "tables" USING btree ("section_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_session_id_table_sessions_id_fk" FOREIGN KEY ("table_session_id") REFERENCES "public"."table_sessions"("id") ON DELETE set null ON UPDATE no action;