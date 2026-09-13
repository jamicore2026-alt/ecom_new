-- This file was generated against src/database/schema.ts (tables: 75 direct, 1 root, 8 child)

-- Enable Row Level Security and per-tenant policies on every
-- merchant-scoped table. Queries must set app.current_merchant_id
-- (see src/database/tenant-context.ts) or they return zero rows.
ALTER TABLE "affiliates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "affiliates" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'affiliates' AND policyname = 'rls_affiliates') THEN
    CREATE POLICY "rls_affiliates" ON "affiliates"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'rls_api_keys') THEN
    CREATE POLICY "rls_api_keys" ON "api_keys"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'rls_audit_logs') THEN
    CREATE POLICY "rls_audit_logs" ON "audit_logs"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "background_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "background_jobs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'background_jobs' AND policyname = 'rls_background_jobs') THEN
    CREATE POLICY "rls_background_jobs" ON "background_jobs"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "bill_of_materials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_of_materials" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bill_of_materials' AND policyname = 'rls_bill_of_materials') THEN
    CREATE POLICY "rls_bill_of_materials" ON "bill_of_materials"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'rls_campaigns') THEN
    CREATE POLICY "rls_campaigns" ON "campaigns"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "carriers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carriers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'carriers' AND policyname = 'rls_carriers') THEN
    CREATE POLICY "rls_carriers" ON "carriers"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'carts' AND policyname = 'rls_carts') THEN
    CREATE POLICY "rls_carts" ON "carts"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'rls_categories') THEN
    CREATE POLICY "rls_categories" ON "categories"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "checkout_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkout_settings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'checkout_settings' AND policyname = 'rls_checkout_settings') THEN
    CREATE POLICY "rls_checkout_settings" ON "checkout_settings"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "cod_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cod_rules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cod_rules' AND policyname = 'rls_cod_rules') THEN
    CREATE POLICY "rls_cod_rules" ON "cod_rules"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "content_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_pages" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content_pages' AND policyname = 'rls_content_pages') THEN
    CREATE POLICY "rls_content_pages" ON "content_pages"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coupons" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coupons' AND policyname = 'rls_coupons') THEN
    CREATE POLICY "rls_coupons" ON "coupons"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_addresses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_addresses' AND policyname = 'rls_customer_addresses') THEN
    CREATE POLICY "rls_customer_addresses" ON "customer_addresses"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "customer_segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_segments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_segments' AND policyname = 'rls_customer_segments') THEN
    CREATE POLICY "rls_customer_segments" ON "customer_segments"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "customer_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_tags" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_tags' AND policyname = 'rls_customer_tags') THEN
    CREATE POLICY "rls_customer_tags" ON "customer_tags"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'rls_customers') THEN
    CREATE POLICY "rls_customers" ON "customers"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "delivery_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_orders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_orders' AND policyname = 'rls_delivery_orders') THEN
    CREATE POLICY "rls_delivery_orders" ON "delivery_orders"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "delivery_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_zones" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_zones' AND policyname = 'rls_delivery_zones') THEN
    CREATE POLICY "rls_delivery_zones" ON "delivery_zones"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "driver_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "driver_assignments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'driver_assignments' AND policyname = 'rls_driver_assignments') THEN
    CREATE POLICY "rls_driver_assignments" ON "driver_assignments"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "driver_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "driver_locations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'driver_locations' AND policyname = 'rls_driver_locations') THEN
    CREATE POLICY "rls_driver_locations" ON "driver_locations"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "drivers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drivers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drivers' AND policyname = 'rls_drivers') THEN
    CREATE POLICY "rls_drivers" ON "drivers"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "email_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_logs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_logs' AND policyname = 'rls_email_logs') THEN
    CREATE POLICY "rls_email_logs" ON "email_logs"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "food_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "food_order_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'food_order_items' AND policyname = 'rls_food_order_items') THEN
    CREATE POLICY "rls_food_order_items" ON "food_order_items"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "fulfillments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fulfillments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fulfillments' AND policyname = 'rls_fulfillments') THEN
    CREATE POLICY "rls_fulfillments" ON "fulfillments"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipts' AND policyname = 'rls_goods_receipts') THEN
    CREATE POLICY "rls_goods_receipts" ON "goods_receipts"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "inventory_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_logs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inventory_logs' AND policyname = 'rls_inventory_logs') THEN
    CREATE POLICY "rls_inventory_logs" ON "inventory_logs"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'invoices' AND policyname = 'rls_invoices') THEN
    CREATE POLICY "rls_invoices" ON "invoices"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "kitchen_stations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_stations" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kitchen_stations' AND policyname = 'rls_kitchen_stations') THEN
    CREATE POLICY "rls_kitchen_stations" ON "kitchen_stations"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "kitchen_ticket_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_ticket_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kitchen_ticket_items' AND policyname = 'rls_kitchen_ticket_items') THEN
    CREATE POLICY "rls_kitchen_ticket_items" ON "kitchen_ticket_items"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_tickets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kitchen_tickets' AND policyname = 'rls_kitchen_tickets') THEN
    CREATE POLICY "rls_kitchen_tickets" ON "kitchen_tickets"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_accounts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loyalty_accounts' AND policyname = 'rls_loyalty_accounts') THEN
    CREATE POLICY "rls_loyalty_accounts" ON "loyalty_accounts"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "loyalty_earning_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_earning_rules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loyalty_earning_rules' AND policyname = 'rls_loyalty_earning_rules') THEN
    CREATE POLICY "rls_loyalty_earning_rules" ON "loyalty_earning_rules"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_ledger" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loyalty_ledger' AND policyname = 'rls_loyalty_ledger') THEN
    CREATE POLICY "rls_loyalty_ledger" ON "loyalty_ledger"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "loyalty_rewards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_rewards" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loyalty_rewards' AND policyname = 'rls_loyalty_rewards') THEN
    CREATE POLICY "rls_loyalty_rewards" ON "loyalty_rewards"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "loyalty_tiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_tiers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loyalty_tiers' AND policyname = 'rls_loyalty_tiers') THEN
    CREATE POLICY "rls_loyalty_tiers" ON "loyalty_tiers"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "menu_item_modifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_item_modifiers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'menu_item_modifiers' AND policyname = 'rls_menu_item_modifiers') THEN
    CREATE POLICY "rls_menu_item_modifiers" ON "menu_item_modifiers"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "menu_item_outlets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_item_outlets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'menu_item_outlets' AND policyname = 'rls_menu_item_outlets') THEN
    CREATE POLICY "rls_menu_item_outlets" ON "menu_item_outlets"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "menu_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'menu_items' AND policyname = 'rls_menu_items') THEN
    CREATE POLICY "rls_menu_items" ON "menu_items"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "merchant_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merchant_modules" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchant_modules' AND policyname = 'rls_merchant_modules') THEN
    CREATE POLICY "rls_merchant_modules" ON "merchant_modules"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modifier_groups" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'modifier_groups' AND policyname = 'rls_modifier_groups') THEN
    CREATE POLICY "rls_modifier_groups" ON "modifier_groups"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "modifiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modifiers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'modifiers' AND policyname = 'rls_modifiers') THEN
    CREATE POLICY "rls_modifiers" ON "modifiers"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_settings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_settings' AND policyname = 'rls_notification_settings') THEN
    CREATE POLICY "rls_notification_settings" ON "notification_settings"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'rls_orders') THEN
    CREATE POLICY "rls_orders" ON "orders"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "outlets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outlets' AND policyname = 'rls_outlets') THEN
    CREATE POLICY "rls_outlets" ON "outlets"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'password_reset_tokens' AND policyname = 'rls_password_reset_tokens') THEN
    CREATE POLICY "rls_password_reset_tokens" ON "password_reset_tokens"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "payment_provider_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_provider_configs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_provider_configs' AND policyname = 'rls_payment_provider_configs') THEN
    CREATE POLICY "rls_payment_provider_configs" ON "payment_provider_configs"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "payment_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_settings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_settings' AND policyname = 'rls_payment_settings') THEN
    CREATE POLICY "rls_payment_settings" ON "payment_settings"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "payment_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_transactions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_transactions' AND policyname = 'rls_payment_transactions') THEN
    CREATE POLICY "rls_payment_transactions" ON "payment_transactions"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "production_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_orders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'production_orders' AND policyname = 'rls_production_orders') THEN
    CREATE POLICY "rls_production_orders" ON "production_orders"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'rls_products') THEN
    CREATE POLICY "rls_products" ON "products"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'promotions' AND policyname = 'rls_promotions') THEN
    CREATE POLICY "rls_promotions" ON "promotions"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'rls_purchase_orders') THEN
    CREATE POLICY "rls_purchase_orders" ON "purchase_orders"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referrals" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referrals' AND policyname = 'rls_referrals') THEN
    CREATE POLICY "rls_referrals" ON "referrals"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'refunds' AND policyname = 'rls_refunds') THEN
    CREATE POLICY "rls_refunds" ON "refunds"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "returns" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'returns' AND policyname = 'rls_returns') THEN
    CREATE POLICY "rls_returns" ON "returns"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviews" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reviews' AND policyname = 'rls_reviews') THEN
    CREATE POLICY "rls_reviews" ON "reviews"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'roles' AND policyname = 'rls_roles') THEN
    CREATE POLICY "rls_roles" ON "roles"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "shipping_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipping_settings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shipping_settings' AND policyname = 'rls_shipping_settings') THEN
    CREATE POLICY "rls_shipping_settings" ON "shipping_settings"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_transfers' AND policyname = 'rls_stock_transfers') THEN
    CREATE POLICY "rls_stock_transfers" ON "stock_transfers"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "store_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_settings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_settings' AND policyname = 'rls_store_settings') THEN
    CREATE POLICY "rls_store_settings" ON "store_settings"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'rls_suppliers') THEN
    CREATE POLICY "rls_suppliers" ON "suppliers"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "table_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "table_sections" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'table_sections' AND policyname = 'rls_table_sections') THEN
    CREATE POLICY "rls_table_sections" ON "table_sections"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "table_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "table_sessions" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'table_sessions' AND policyname = 'rls_table_sessions') THEN
    CREATE POLICY "rls_table_sessions" ON "table_sessions"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tables" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tables' AND policyname = 'rls_tables') THEN
    CREATE POLICY "rls_tables" ON "tables"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "tax_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_settings" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tax_settings' AND policyname = 'rls_tax_settings') THEN
    CREATE POLICY "rls_tax_settings" ON "tax_settings"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "theme_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "theme_configs" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'theme_configs' AND policyname = 'rls_theme_configs') THEN
    CREATE POLICY "rls_theme_configs" ON "theme_configs"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'rls_users') THEN
    CREATE POLICY "rls_users" ON "users"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'verification_tokens' AND policyname = 'rls_verification_tokens') THEN
    CREATE POLICY "rls_verification_tokens" ON "verification_tokens"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'visits' AND policyname = 'rls_visits') THEN
    CREATE POLICY "rls_visits" ON "visits"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "warehouse_inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouse_inventory" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'warehouse_inventory' AND policyname = 'rls_warehouse_inventory') THEN
    CREATE POLICY "rls_warehouse_inventory" ON "warehouse_inventory"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'warehouses' AND policyname = 'rls_warehouses') THEN
    CREATE POLICY "rls_warehouses" ON "warehouses"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'webhook_deliveries' AND policyname = 'rls_webhook_deliveries') THEN
    CREATE POLICY "rls_webhook_deliveries" ON "webhook_deliveries"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'webhook_endpoints' AND policyname = 'rls_webhook_endpoints') THEN
    CREATE POLICY "rls_webhook_endpoints" ON "webhook_endpoints"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "wishlist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wishlist_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wishlist_items' AND policyname = 'rls_wishlist_items') THEN
    CREATE POLICY "rls_wishlist_items" ON "wishlist_items"
      FOR ALL USING (merchant_id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (merchant_id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "merchants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merchants" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'merchants' AND policyname = 'rls_merchants') THEN
    CREATE POLICY "rls_merchants" ON "merchants"
      FOR ALL USING (id = (current_setting('app.current_merchant_id', true)::varchar))
      WITH CHECK (id = (current_setting('app.current_merchant_id', true)::varchar));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "bom_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bom_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bom_items' AND policyname = 'rls_bom_items') THEN
    CREATE POLICY "rls_bom_items" ON "bom_items"
      FOR ALL USING (EXISTS (SELECT 1 FROM "bill_of_materials" WHERE "bill_of_materials".id = "bom_items"."bom_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)))
      WITH CHECK (EXISTS (SELECT 1 FROM "bill_of_materials" WHERE "bill_of_materials".id = "bom_items"."bom_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipt_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goods_receipt_items' AND policyname = 'rls_goods_receipt_items') THEN
    CREATE POLICY "rls_goods_receipt_items" ON "goods_receipt_items"
      FOR ALL USING (EXISTS (SELECT 1 FROM "goods_receipts" WHERE "goods_receipts".id = "goods_receipt_items"."goods_receipt_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)))
      WITH CHECK (EXISTS (SELECT 1 FROM "goods_receipts" WHERE "goods_receipts".id = "goods_receipt_items"."goods_receipt_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'rls_order_items') THEN
    CREATE POLICY "rls_order_items" ON "order_items"
      FOR ALL USING (EXISTS (SELECT 1 FROM "orders" WHERE "orders".id = "order_items"."order_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)))
      WITH CHECK (EXISTS (SELECT 1 FROM "orders" WHERE "orders".id = "order_items"."order_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_images" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'product_images' AND policyname = 'rls_product_images') THEN
    CREATE POLICY "rls_product_images" ON "product_images"
      FOR ALL USING (EXISTS (SELECT 1 FROM "products" WHERE "products".id = "product_images"."product_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)))
      WITH CHECK (EXISTS (SELECT 1 FROM "products" WHERE "products".id = "product_images"."product_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'product_variants' AND policyname = 'rls_product_variants') THEN
    CREATE POLICY "rls_product_variants" ON "product_variants"
      FOR ALL USING (EXISTS (SELECT 1 FROM "products" WHERE "products".id = "product_variants"."product_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)))
      WITH CHECK (EXISTS (SELECT 1 FROM "products" WHERE "products".id = "product_variants"."product_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "production_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_order_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'production_order_items' AND policyname = 'rls_production_order_items') THEN
    CREATE POLICY "rls_production_order_items" ON "production_order_items"
      FOR ALL USING (EXISTS (SELECT 1 FROM "production_orders" WHERE "production_orders".id = "production_order_items"."production_order_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)))
      WITH CHECK (EXISTS (SELECT 1 FROM "production_orders" WHERE "production_orders".id = "production_order_items"."production_order_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_items" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_order_items' AND policyname = 'rls_purchase_order_items') THEN
    CREATE POLICY "rls_purchase_order_items" ON "purchase_order_items"
      FOR ALL USING (EXISTS (SELECT 1 FROM "purchase_orders" WHERE "purchase_orders".id = "purchase_order_items"."purchase_order_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)))
      WITH CHECK (EXISTS (SELECT 1 FROM "purchase_orders" WHERE "purchase_orders".id = "purchase_order_items"."purchase_order_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "user_outlets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_outlets" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_outlets' AND policyname = 'rls_user_outlets') THEN
    CREATE POLICY "rls_user_outlets" ON "user_outlets"
      FOR ALL USING (EXISTS (SELECT 1 FROM "outlets" WHERE "outlets".id = "user_outlets"."outlet_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)))
      WITH CHECK (EXISTS (SELECT 1 FROM "outlets" WHERE "outlets".id = "user_outlets"."outlet_id" AND merchant_id = (current_setting('app.current_merchant_id', true)::varchar)));
  END IF;
END $$;
--> statement-breakpoint
