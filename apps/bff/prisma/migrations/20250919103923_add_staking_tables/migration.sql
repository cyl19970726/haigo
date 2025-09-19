-- DropIndex
DROP INDEX "accounts_address_idx";

-- AlterTable
ALTER TABLE "accounts" ALTER COLUMN "chain_timestamp" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "media_assets" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "staking_positions" (
    "warehouse_address" TEXT NOT NULL,
    "staked_amount" BIGINT NOT NULL,
    "last_txn_version" BIGINT,
    "last_event_index" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staking_positions_pkey" PRIMARY KEY ("warehouse_address")
);

-- CreateTable
CREATE TABLE "storage_fees_cache" (
    "warehouse_address" TEXT NOT NULL,
    "fee_per_unit" INTEGER NOT NULL,
    "last_txn_version" BIGINT,
    "last_event_index" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_fees_cache_pkey" PRIMARY KEY ("warehouse_address")
);

-- CreateIndex
CREATE INDEX "staking_positions_cursor_idx" ON "staking_positions"("last_txn_version", "last_event_index");

-- CreateIndex
CREATE INDEX "storage_fees_cursor_idx" ON "storage_fees_cache"("last_txn_version", "last_event_index");
