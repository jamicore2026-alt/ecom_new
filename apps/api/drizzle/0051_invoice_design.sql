-- Invoice document design options (item 7).
ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "layout_style" varchar(20) NOT NULL DEFAULT 'light';
ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "table_style" varchar(20) NOT NULL DEFAULT 'light';
ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "font_family" varchar(20) NOT NULL DEFAULT 'helvetica';
ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "accent_color" varchar(20) NOT NULL DEFAULT '#004ac6';
ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "paper_format" varchar(20) NOT NULL DEFAULT 'A4';
ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "tagline" varchar(255);
ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "bank_account" text;
ALTER TABLE "invoice_settings" ADD COLUMN IF NOT EXISTS "show_qr" boolean NOT NULL DEFAULT false;
