CREATE TABLE "product_images" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"product_id" varchar(30) NOT NULL,
	"url" varchar(1024) NOT NULL,
	"alt_text" varchar(255),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id");