-- Pool-source reversals credit the pool back: no destination warehouse.
ALTER TABLE "stock_transfers" ALTER COLUMN "to_warehouse_id" DROP NOT NULL;
