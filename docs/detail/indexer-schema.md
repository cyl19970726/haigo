# HaiGo Aptos Indexer Schema (PoC)

本方案定义 No-Code Indexer 与 Hasura 的最小化表结构，覆盖 PRD 中的五类事件：注册、订单、质押、理赔、评分。目标是在 PoC 阶段快速完成链上事件 → Postgres → API 的闭环，同时为后续扩展预留空间。

## 1. 核心表结构

```sql
-- 1.1 账户注册（SellerRegistered / WarehouseRegistered）
CREATE TABLE IF NOT EXISTS accounts (
  account_address    TEXT PRIMARY KEY,
  role               TEXT NOT NULL CHECK (role IN ('seller', 'warehouse')),
  profile_hash_algo  TEXT NOT NULL DEFAULT 'blake3',
  profile_hash_value TEXT NOT NULL,
  profile_uri        TEXT,
  registered_by      TEXT NOT NULL, -- tx signer, usually same as account
  txn_version        BIGINT NOT NULL,
  event_index        BIGINT NOT NULL,
  txn_hash           TEXT NOT NULL,
  chain_timestamp    TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_event_uniq ON accounts (txn_version, event_index);

-- 1.2 订单主表（OrderCreated + 最新状态）
CREATE TABLE IF NOT EXISTS orders (
  record_uid           TEXT PRIMARY KEY,
  creator_address      TEXT NOT NULL,
  warehouse_address    TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN (
    'ORDER_CREATED', 'WAREHOUSE_IN', 'IN_STORAGE', 'WAREHOUSE_OUT'
  )),
  currency             TEXT NOT NULL DEFAULT 'APT',
  storage_fee          NUMERIC(24, 8) NOT NULL,
  insurance_fee        NUMERIC(24, 8) NOT NULL,
  logistics_inbound_no TEXT,
  logistics_outbound_no TEXT,
  last_media_hash_algo TEXT,
  last_media_hash_value TEXT,
  last_event_type      TEXT NOT NULL,
  last_event_version   BIGINT NOT NULL,
  last_event_index     BIGINT NOT NULL,
  last_event_hash      TEXT NOT NULL,
  last_event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_creator_idx ON orders (creator_address);
CREATE INDEX IF NOT EXISTS orders_warehouse_idx ON orders (warehouse_address);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

-- 1.3 订单事件明细（全量时间线）
CREATE TABLE IF NOT EXISTS order_events (
  id                  BIGSERIAL PRIMARY KEY,
  record_uid          TEXT NOT NULL,
  event_type          TEXT NOT NULL CHECK (event_type IN (
    'ORDER_CREATED', 'WAREHOUSE_IN', 'IN_STORAGE', 'WAREHOUSE_OUT'
  )),
  media_hash_algo     TEXT,
  media_hash_value    TEXT,
  logistics_no        TEXT,
  payload             JSONB DEFAULT '{}'::JSONB,
  txn_version         BIGINT NOT NULL,
  event_index         BIGINT NOT NULL,
  txn_hash            TEXT NOT NULL,
  chain_timestamp     TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS order_events_event_uniq ON order_events (txn_version, event_index);
CREATE INDEX IF NOT EXISTS order_events_record_idx ON order_events (record_uid);

-- 1.4 质押事件（StakeChanged）
CREATE TABLE IF NOT EXISTS staking_positions (
  id                 BIGSERIAL PRIMARY KEY,
  owner_address      TEXT NOT NULL,
  asset_type         TEXT NOT NULL, -- e.g. 0x1::aptos_coin::AptosCoin or stablecoin type tag
  total_amount       NUMERIC(36, 8) NOT NULL,
  credit_weight      NUMERIC(12, 4),
  txn_version        BIGINT NOT NULL,
  event_index        BIGINT NOT NULL,
  txn_hash           TEXT NOT NULL,
  chain_timestamp    TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS staking_event_uniq ON staking_positions (txn_version, event_index);
CREATE INDEX IF NOT EXISTS staking_owner_idx ON staking_positions (owner_address);

-- 1.5 理赔事件（ClaimOpened / ClaimResolved）
CREATE TABLE IF NOT EXISTS claims (
  claim_id            TEXT PRIMARY KEY,
  record_uid          TEXT NOT NULL,
  claimant_address    TEXT NOT NULL,
  resolver_address    TEXT,
  status              TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'REJECTED')),
  payout_amount       NUMERIC(24, 8),
  payout_currency     TEXT DEFAULT 'APT',
  evidence_hash_algo  TEXT,
  evidence_hash_value TEXT,
  resolution_hash_algo  TEXT,
  resolution_hash_value TEXT,
  last_event_version  BIGINT NOT NULL,
  last_event_index    BIGINT NOT NULL,
  last_event_hash     TEXT NOT NULL,
  chain_timestamp     TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS claims_record_idx ON claims (record_uid);
CREATE UNIQUE INDEX IF NOT EXISTS claims_event_uniq ON claims (last_event_version, last_event_index);

-- 1.6 评分事件（RatingSubmitted）
CREATE TABLE IF NOT EXISTS ratings (
  id                BIGSERIAL PRIMARY KEY,
  rater_address     TEXT NOT NULL,
  warehouse_address TEXT NOT NULL,
  record_uid        TEXT NOT NULL,
  score             SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  review_hash_algo  TEXT,
  review_hash_value TEXT,
  txn_version       BIGINT NOT NULL,
  event_index       BIGINT NOT NULL,
  txn_hash          TEXT NOT NULL,
  chain_timestamp   TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ratings_event_uniq ON ratings (txn_version, event_index);
CREATE INDEX IF NOT EXISTS ratings_warehouse_idx ON ratings (warehouse_address);
```

> 说明：`txn_version` / `event_index` 作为去重与回放锚点。所有事件表都以链上发生时间 (`chain_timestamp`) 记录，便于 BFF 与前端排序。`payload` 字段保留原始 Move 事件结构，保障未来扩展。

## 2. 事件字段映射

| Move 事件 | 目标表 | 核心字段映射 |
|-----------|--------|---------------|
| `SellerRegistered { account, profile_hash, profile_uri }` | `accounts` | `account_address = account`, `role = 'seller'`, `profile_hash_value = profile_hash.value`, `profile_hash_algo = profile_hash.algo` |
| `WarehouseRegistered { account, profile_hash, profile_uri }` | `accounts` | 同上，`role = 'warehouse'` |
| `OrderCreated { record_uid, creator, warehouse, storage_fee, insurance_fee, currency }` | `orders` & `order_events` | 初始化 `orders` 行，`order_events` 新增 `event_type = 'ORDER_CREATED'`，`payload` 保存手续费拆解 |
| `CheckedIn { record_uid, warehouse, logistics_no, media_hash }` | `orders` & `order_events` | 更新 `orders.status = 'WAREHOUSE_IN'`，写入 `logistics_inbound_no`、`last_media_hash_*`；`order_events` 添加一行 |
| `SetInStorage { record_uid, warehouse, media_hash }` | `orders` & `order_events` | 更新 `status = 'IN_STORAGE'`、刷新 `last_media_hash_*` |
| `CheckedOut { record_uid, actor, logistics_no, media_hash }` | `orders` & `order_events` | 更新 `status = 'WAREHOUSE_OUT'`、`logistics_outbound_no`、`last_media_hash_*` |
| `StakeChanged { owner, asset_type, total_amount, credit_weight }` | `staking_positions` | 每次事件插入新行保存快照；BFF 通过 `ORDER BY txn_version DESC` 获取最新值 |
| `ClaimOpened { claim_id, record_uid, claimant, evidence_hash }` | `claims` | 如无记录则 `INSERT`，并设 `status = 'OPEN'` |
| `ClaimResolved { claim_id, resolver, payout_amount, status, resolution_hash }` | `claims` | `UPSERT`：更新 `status`（`RESOLVED`/`REJECTED`）、补充 `resolver_address`、`payout_*`、`resolution_hash_*` |
| `RatingSubmitted { rater, warehouse, record_uid, score, review_hash }` | `ratings` | 直接 `INSERT`，重复提交依事件 version/index 去重 |

## 3. Hasura 配置指南（PoC）

1. **追踪表**：在 Hasura Console 中依次 `Track` 上述六张表。
2. **Relationships**：
   - `orders` → `order_events`：`record_uid` 1:N。
   - `orders` → `claims`：`record_uid` 1:N。
   - `orders` → `ratings`：`record_uid` 1:N。
   - `accounts` → `orders`：`account_address` 对 `creator_address`、`warehouse_address` 建多关系（使用手动对象关系）。
3. **视图（可选）**：创建 `order_latest_events` 视图聚合最近一次事件，便于首页查询。
4. **权限**：
   - `anonymous` 角色允许 `select`，但对 PII 字段（如果后续添加）限制列；当前 PoC 所有数据可公开。
   - `operations` 角色（平台内部）可访问全部列并执行 `aggregate` 查询。
5. **枚举处理**：若需 GraphQL enum，可在 Hasura 中将 `orders.status` 与 `claims.status` 通过 `enum table` 或 `graphql_enum_mapping` 映射成枚举类型。
6. **环境变量**：
   ```env
   HASURA_GRAPHQL_DATABASE_URL=postgres://.../haigo_indexer
   HASURA_GRAPHQL_ADMIN_SECRET=change-me
   HASURA_GRAPHQL_ENABLED_LOG_TYPES=startup,http-log,webhook-log,websocket-log
   ```
7. **初始化顺序**：先执行 SQL 建表，再在 Hasura Console 导入 `metadata`（或通过 CLI `hasura metadata apply`）。

## 4. 数据刷新与回放
- 对于 No-Code Indexer，配置目标表时选择 `Upsert` 策略，在主键或唯一约束冲突时按最新 `txn_version` 覆盖。
- 若链上发生 Reorg，No-Code Indexer 会回放更低版本数据，建议在 `order_events` / `claims` 中保留所有版本，并通过 `last_event_version` 标识最新状态。
- 定期执行 `VACUUM ANALYZE` 以保持 Postgres 查询性能。

## 5. 后续扩展
- 若未来引入 OSS 等对象存储，可在 `order_events.payload` 中增加媒体 URL，并在 `claims` 表添加 `evidence_uri` 等字段。
- 当需要多货币支持，可拆分 `orders_amounts` 子表，记录资产类型与金额明细。
- 对运营指标，可另建 `materialized views`（如日订单量、质押总额），减少前端聚合压力。
```
