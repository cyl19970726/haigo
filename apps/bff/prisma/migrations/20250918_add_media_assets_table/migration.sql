-- Create media_assets table for inbound/outbound media uploads
CREATE TABLE IF NOT EXISTS "media_assets" (
    "id" BIGSERIAL PRIMARY KEY,
    "record_uid" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "public_path" TEXT,
    "hash_algo" TEXT NOT NULL,
    "hash_value" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched_offchain" BOOLEAN NOT NULL DEFAULT FALSE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_record_path_uniq" ON "media_assets"("record_uid", "storage_path");
CREATE INDEX IF NOT EXISTS "media_assets_record_uid_idx" ON "media_assets"("record_uid");
CREATE INDEX IF NOT EXISTS "media_assets_hash_value_idx" ON "media_assets"("hash_value");
