CREATE TABLE "merchant_modules" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"module" varchar(30) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"merchant_id" varchar(30) NOT NULL,
	"name" varchar(50) NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" varchar(20) DEFAULT 'MERCHANT' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_outlets" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"user_id" varchar(30) NOT NULL,
	"outlet_id" varchar(30) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_modules" ADD CONSTRAINT "merchant_modules_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_outlets" ADD CONSTRAINT "user_outlets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_outlets" ADD CONSTRAINT "user_outlets_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_modules_merchant_module_idx" ON "merchant_modules" USING btree ("merchant_id","module");--> statement-breakpoint
CREATE UNIQUE INDEX "outlets_merchant_code_idx" ON "outlets" USING btree ("merchant_id","code");--> statement-breakpoint
CREATE INDEX "outlets_merchant_idx" ON "outlets" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_merchant_name_idx" ON "roles" USING btree ("merchant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "user_outlets_user_outlet_idx" ON "user_outlets" USING btree ("user_id","outlet_id");--> statement-breakpoint
CREATE INDEX "user_outlets_outlet_idx" ON "user_outlets" USING btree ("outlet_id");