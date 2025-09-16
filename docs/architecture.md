# HaiGo 海行 – Architecture v1.0.1

> 修订要点：
>
> 1. **写直链**：前端通过钱包直接与 Aptos 交互进行所有需要签名的写操作；
> 2. **BFF 只读**：BFF/Indexer 仅做读取加速、聚合与链下能力（预签名上传、搜索、排行、风控 Hook），不代签、不代付；
> 3. **媒体链下 + 哈希上链**：大体量媒体（图片/视频）链下存储，链上仅保存 `ContentHash` 与必要元数据。

---

## 0. Goals & Scope

* **目标**：以 Aptos 为底层，将跨境仓储履约的关键数据可信上链，构建“可追溯、可审计、低成本、可扩展”的海外家庭仓 RWA 平台。
* **范围**：

  * **On-chain**：订单状态机、事件模型、账户/权限约束；质押与保险接口位。
  * **Off-chain**：BFF（只读）、事件索引、媒体存储与校验、排名与可视化。
  * **Frontend**：商家/仓主/平台三端 dApp；钱包签名、直链读写、媒体上载与验证。
  * **横切**：安全、隐私与合规、可观测性、部署与灰度、容量与成本。

---

## 1. Architectural Principles

1. **写直链**：任何需要签名的交易（Create/Check-in/SetStorage/Check-out/Stake/Claim/Rate）均由前端 dApp 通过钱包签名并直接提交到链。
2. **读写分离**：关键读（决定交易前的状态）优先直读链；复杂列表/聚合读可经 BFF 缓存与索引。
3. **最小上链**：只上链关键业务字段与内容哈希；媒体与隐私信息链下。
4. **事件驱动**：以链上 Event 为事实来源（SoT）；BFF 异步消费事件构建 Read Model。
5. **最小权限**：地址即身份；状态转换仅限权利人（卖家/仓主/授权操作员）。
6. **可验证性**：展示媒体前进行本地哈希校验（链上哈希对比）。
7. **可演进**：合约保留 `version`/FeatureGate；BFF 与前端使用接口与协议解耦。

---

## 2. High-level Topology

```
[ User Wallet (Petra…)]
        │ sign
        ▼
Frontend dApp (Next.js/TS)
  ├─ Aptos SDK → Fullnode RPC  ←──►  Move Contracts (haigo::warehouse_rwa)
  ├─ Read (critical) → Indexer RPC / Fullnode
  ├─ Upload → S3/MinIO 等对象存储（Presigned URL）
  └─ Optional Read → BFF (aggregate/search/ranking)

BFF (Read-only / Off-chain)
  ├─ Event Consumer → Read Models (Postgres/Redis)
  ├─ Search/Ranking/Maps API
  ├─ Media Presign / Commit metadata
  └─ Risk/KYC/AML Hooks (链下资源访问门槛)
```

---

## 3. Domain & Data (DDD Sketch)

**限界上下文**：

* **Order**：订单主数据与状态机（CREATED → IN → STORAGE → OUT）。
* **Stake**：仓主质押与信用权重（扩展模块）。
* **Insurance**：保险保费、理赔申请与裁决（扩展模块）。
* **Reputation**：评分与评价（review\_hash 上链，正文链下）。
* **Media**：对象存储与哈希校验。

**链上主结构（摘要）**：

* `WarehouseRecord { record_uid, seller, warehouse, status, value_declared, fees, payment_tx_hash, ts, logistics[], meta_hash, policy }`
* `LogisticsEntry { action(IN/OUT), tracking_no, media(ContentHash), ts }`
* `ContentHash { algo, digest }` （如 `keccak256`, `blake3`）

**链下 Read Models**（Postgres/Redis）：

* `orders`、`warehouses`、`scores`、`media_objects`（含 object\_key/hash/algo/size/mime/uploader/ts）。

---

## 4. Smart Contract Design (Aptos/Move)

**Module**：`haigo::warehouse_rwa`

**State Constants**：`0=CREATED, 1=IN, 2=STORAGE, 3=OUT`

**Events**：`OrderCreatedEvent`、`CheckedInEvent`、`SetInStorageEvent`、`CheckedOutEvent`

**Entry Functions**（与 PRD 对齐）：

* `create_order(seller, warehouse, value_declared, storage_fee, insurance_fee, payment_tx_hash, meta_hash?) -> record_uid`
* `check_in(record_uid, in_tracking_no, in_media_hash)`
* `set_in_storage(record_uid)`
* `check_out(record_uid, out_tracking_no, out_media_hash)`
* 扩展位：`stake/unstake`、`open_claim/resolve_claim`、`rate_warehouse`

**Access Control**：

* `create_order` 仅 `seller` 签名地址可调；
* `check_in / set_in_storage / check_out` 仅 `warehouse` 地址或其授权操作员；
* 严格状态流转顺序与幂等；暂停开关（紧急止血）。

**存储策略**：只保存关键字段与 `ContentHash`；媒体不上链。

### 4.1 MVP Module Skeleton（可编译骨架）

```move
module haigo::warehouse_rwa {
    use std::signer;
    use std::vector;
    use aptos_std::account;
    use aptos_std::event::{self, EventHandle};
    use aptos_std::option::{self, Option};
    use aptos_std::table::{self, Table};

    const ADMIN: address = @haigo;
    const STATUS_CREATED: u8 = 0;
    const STATUS_IN: u8 = 1;
    const STATUS_STORAGE: u8 = 2;
    const STATUS_OUT: u8 = 3;

    const E_ALREADY_INITIALIZED: u64 = 1;
    const E_NOT_INITIALIZED: u64 = 2;
    const E_UNAUTHORIZED: u64 = 3;
    const E_INVALID_TRANSITION: u64 = 4;
    const E_RECORD_NOT_FOUND: u64 = 5;
    const E_INVALID_HASH: u64 = 6;
    const E_INVALID_FEE: u64 = 7;

    struct ContentHash has copy, drop, store {
        algo: u8,
        digest: vector<u8>,
    }

    struct LogisticsSnapshot has copy, drop, store {
        tracking_no: vector<u8>,
        media_hash: ContentHash,
        client_ts: u64,
    }

    struct WarehouseRecord has copy, drop, store {
        uid: u64,
        seller: address,
        warehouse: address,
        status: u8,
        value_declared: u64,
        storage_fee: u64,
        insurance_fee: u64,
        payment_tx_hash: vector<u8>,
        meta_hash: Option<ContentHash>,
        created_at: u64,
        in_storage_at: Option<u64>,
        check_in: Option<LogisticsSnapshot>,
        check_out: Option<LogisticsSnapshot>,
    }

    struct OrderStore has key {
        next_uid: u64,
        records: Table<u64, WarehouseRecord>,
    }

    struct OrderEvents has key {
        order_created_events: EventHandle<OrderCreatedEvent>,
        checked_in_events: EventHandle<CheckedInEvent>,
        in_storage_events: EventHandle<SetInStorageEvent>,
        checked_out_events: EventHandle<CheckedOutEvent>,
    }

    struct OrderCreatedEvent has drop, store {
        record_uid: u64,
        seller: address,
        warehouse: address,
        storage_fee: u64,
        insurance_fee: u64,
    }

    struct CheckedInEvent has drop, store {
        record_uid: u64,
        warehouse: address,
        tracking_no: vector<u8>,
    }

    struct SetInStorageEvent has drop, store {
        record_uid: u64,
        warehouse: address,
    }

    struct CheckedOutEvent has drop, store {
        record_uid: u64,
        warehouse: address,
        tracking_no: vector<u8>,
    }

    public entry fun init_module(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == ADMIN, E_UNAUTHORIZED);
        assert!(!exists<OrderStore>(ADMIN), E_ALREADY_INITIALIZED);
        move_to(admin, OrderStore { next_uid: 0, records: table::new() });
        move_to(admin, OrderEvents {
            order_created_events: event::new_event_handle<OrderCreatedEvent>(admin),
            checked_in_events: event::new_event_handle<CheckedInEvent>(admin),
            in_storage_events: event::new_event_handle<SetInStorageEvent>(admin),
            checked_out_events: event::new_event_handle<CheckedOutEvent>(admin),
        });
    }

    public entry fun create_order(
        seller: &signer,
        warehouse: address,
        value_declared: u64,
        storage_fee: u64,
        insurance_fee: u64,
        payment_tx_hash: vector<u8>,
        has_meta_hash: bool,
        meta_hash_algo: u8,
        meta_hash_digest: vector<u8>,
        client_created_at: u64,
    ) acquires OrderStore, OrderEvents {
        let seller_addr = signer::address_of(seller);

        assert!(storage_fee > 0, E_INVALID_FEE);
        assert!(insurance_fee > 0, E_INVALID_FEE);

        let meta_hash = if (has_meta_hash) {
            option::some(new_content_hash(meta_hash_algo, meta_hash_digest))
        } else {
            let _ = meta_hash_digest;
            option::none<ContentHash>()
        };

        let store = borrow_store_mut();
        let record_uid = next_uid(store);
        let record = WarehouseRecord {
            uid: record_uid,
            seller: seller_addr,
            warehouse,
            status: STATUS_CREATED,
            value_declared,
            storage_fee,
            insurance_fee,
            payment_tx_hash,
            meta_hash,
            created_at: client_created_at,
            in_storage_at: option::none<u64>(),
            check_in: option::none<LogisticsSnapshot>(),
            check_out: option::none<LogisticsSnapshot>(),
        };
        table::add(&mut store.records, record_uid, record);

        let events = borrow_events_mut();
        event::emit_event(
            &mut events.order_created_events,
            OrderCreatedEvent {
                record_uid,
                seller: seller_addr,
                warehouse,
                storage_fee,
                insurance_fee,
            },
        );
    }

    public entry fun check_in(
        warehouse_signer: &signer,
        record_uid: u64,
        tracking_no: vector<u8>,
        media_hash_algo: u8,
        media_hash_digest: vector<u8>,
        client_ts: u64,
    ) acquires OrderStore, OrderEvents {
        let warehouse_addr = signer::address_of(warehouse_signer);
        let store = borrow_store_mut();
        let record = borrow_record_mut(store, record_uid);
        assert!(record.status == STATUS_CREATED, E_INVALID_TRANSITION);
        assert!(record.warehouse == warehouse_addr, E_UNAUTHORIZED);

        let tracking_for_event = vector::clone(&tracking_no);
        let media_hash = new_content_hash(media_hash_algo, media_hash_digest);

        record.status = STATUS_IN;
        record.check_in = option::some(LogisticsSnapshot {
            tracking_no,
            media_hash,
            client_ts,
        });

        let events = borrow_events_mut();
        event::emit_event(
            &mut events.checked_in_events,
            CheckedInEvent {
                record_uid,
                warehouse: warehouse_addr,
                tracking_no: tracking_for_event,
            },
        );
    }

    public entry fun set_in_storage(
        warehouse_signer: &signer,
        record_uid: u64,
        client_ts: u64,
    ) acquires OrderStore, OrderEvents {
        let warehouse_addr = signer::address_of(warehouse_signer);

        let store = borrow_store_mut();
        let record = borrow_record_mut(store, record_uid);
        assert!(record.status == STATUS_IN, E_INVALID_TRANSITION);
        assert!(record.warehouse == warehouse_addr, E_UNAUTHORIZED);

        record.status = STATUS_STORAGE;
        record.in_storage_at = option::some(client_ts);

        let events = borrow_events_mut();
        event::emit_event(
            &mut events.in_storage_events,
            SetInStorageEvent { record_uid, warehouse: warehouse_addr },
        );
    }

    public entry fun check_out(
        warehouse_signer: &signer,
        record_uid: u64,
        tracking_no: vector<u8>,
        media_hash_algo: u8,
        media_hash_digest: vector<u8>,
        client_ts: u64,
    ) acquires OrderStore, OrderEvents {
        let warehouse_addr = signer::address_of(warehouse_signer);

        let store = borrow_store_mut();
        let record = borrow_record_mut(store, record_uid);
        assert!(record.status == STATUS_STORAGE, E_INVALID_TRANSITION);
        assert!(record.warehouse == warehouse_addr, E_UNAUTHORIZED);

        let tracking_for_event = vector::clone(&tracking_no);
        let media_hash = new_content_hash(media_hash_algo, media_hash_digest);

        record.status = STATUS_OUT;
        record.check_out = option::some(LogisticsSnapshot {
            tracking_no,
            media_hash,
            client_ts,
        });

        let events = borrow_events_mut();
        event::emit_event(
            &mut events.checked_out_events,
            CheckedOutEvent {
                record_uid,
                warehouse: warehouse_addr,
                tracking_no: tracking_for_event,
            },
        );
    }

    fun new_content_hash(algo: u8, digest: vector<u8>): ContentHash {
        assert!(vector::length(&digest) > 0, E_INVALID_HASH);
        ContentHash { algo, digest }
    }

    fun borrow_store_mut(): &mut OrderStore acquires OrderStore {
        assert!(exists<OrderStore>(ADMIN), E_NOT_INITIALIZED);
        borrow_global_mut<OrderStore>(ADMIN)
    }

    fun borrow_events_mut(): &mut OrderEvents acquires OrderEvents {
        assert!(exists<OrderEvents>(ADMIN), E_NOT_INITIALIZED);
        borrow_global_mut<OrderEvents>(ADMIN)
    }

    fun borrow_record_mut(store: &mut OrderStore, record_uid: u64): &mut WarehouseRecord {
        if (!table::contains(&store.records, record_uid)) {
            abort E_RECORD_NOT_FOUND;
        };
        table::borrow_mut(&mut store.records, record_uid)
    }

    fun next_uid(store: &mut OrderStore): u64 {
        let uid = store.next_uid;
        store.next_uid = uid + 1;
        uid
    }

    #[test]
    fun test_happy_path() {
        let admin_signer = account::create_account_for_test(ADMIN);
        init_module(&admin_signer);

        let seller = account::create_account_for_test(@0x100);
        let warehouse = account::create_account_for_test(@0x200);

        create_order(
            &seller,
            signer::address_of(&warehouse),
            1_000,
            100,
            10,
            b"tx_hash",
            false,
            0,
            b"",
            0,
        );

        check_in(&warehouse, 0, b"TRACK-IN", 1, b"digest-in", 1);

        set_in_storage(&warehouse, 0, 2);

        check_out(&warehouse, 0, b"TRACK-OUT", 1, b"digest-out", 3);

        // TODO: add invariant assertions once storage layout finalized.
    }
}
```

### 4.2 事件与错误码对照

| 项目 | 描述 | 触发点 |
| --- | --- | --- |
| `OrderCreatedEvent` | 订单创建成功 | `create_order` |
| `CheckedInEvent` | 入库完成 | `check_in` |
| `SetInStorageEvent` | 仓储状态确认 | `set_in_storage` |
| `CheckedOutEvent` | 出库完成 | `check_out` |

| 错误码 | 数值 | 说明 |
| --- | --- | --- |
| `E_ALREADY_INITIALIZED` | 1 | 模块重复初始化 |
| `E_NOT_INITIALIZED` | 2 | 未先调用 `init_module` |
| `E_UNAUTHORIZED` | 3 | 调用者不具备权限 |
| `E_INVALID_TRANSITION` | 4 | 状态机越序或重复 |
| `E_RECORD_NOT_FOUND` | 5 | 订单不存在 |
| `E_INVALID_HASH` | 6 | 内容哈希为空或不合法 |
| `E_INVALID_FEE` | 7 | 费用为 0，违反业务校验 |

### 4.3 单测与验证大纲

1. **Happy Path**：下单 → 入库 → 仓储 → 出库；断言状态、哈希、事件计数。
2. **权限**：卖家无法调用入库/出库；仓主地址不匹配时报错 `E_UNAUTHORIZED`。
3. **状态机**：重复调用或跳过步骤返回 `E_INVALID_TRANSITION`。
4. **输入校验**：哈希为空、费用为零触发对应错误码。
5. **回放测试**：使用事件回放重建读模型（链下测试）。

---

## 5. Frontend Architecture

* **框架**：Next.js + TypeScript；组件库统一（表单、卡片、徽章、空/错态）。
* **钱包**：Aptos 钱包适配（Petra 等）；`useWallet()` 封装签名与网络切换。
* **直链写入流程**：

  1. 直传媒体 → 本地计算 `content_hash`
  2. Dry-run 估算 gas → 钱包签名 → 直接广播交易
  3. 轮询/订阅确认 → UI 状态 `pending → confirmed`
* **关键读取策略**：详情页 **直读链**（防索引延迟）；列表/排行榜可走 BFF 并在详情处二次直链确认。
* **可验证性**：展示媒体前再次计算哈希，与链上哈希比对一致才显示“已验证”。

### 5.4 直链交互模板（TypeScript）

```ts
import { Aptos, AptosConfig, Network, InputEntryFunctionData, UserTransactionResponse } from "@aptos-labs/ts-sdk";
import { WalletClient } from "@aptos-labs/wallet-adapter-core";

const MODULE_ADDRESS = process.env.NEXT_PUBLIC_HAIGO_MODULE_ADDRESS!;
const MODULE = `${MODULE_ADDRESS}::warehouse_rwa`;

const textEncoder = new TextEncoder();

export type MediaHash = {
  algo: number;
  digest: Uint8Array;
};

export type CreateOrderArgs = {
  warehouse: string;
  valueDeclared: bigint;
  storageFee: bigint;
  insuranceFee: bigint;
  paymentTxHash: Uint8Array;
  metaHash?: MediaHash;
  clientCreatedAt: bigint;
};

export type CheckpointArgs = {
  recordUid: bigint;
  trackingNo: string;
  mediaHash: MediaHash;
  clientTs: bigint;
};

const aptos = new Aptos(new AptosConfig({ network: (process.env.NEXT_PUBLIC_APTOS_NETWORK as Network) ?? Network.TESTNET }));

async function signAndSubmit(
  wallet: WalletClient,
  sender: string,
  data: InputEntryFunctionData
): Promise<UserTransactionResponse> {
  const pending = await wallet.signAndSubmitTransaction({ sender, data });
  return aptos.waitForTransaction({ transactionHash: pending.hash });
}

export async function createOrder(wallet: WalletClient, sender: string, args: CreateOrderArgs) {
  const hasMeta = Boolean(args.metaHash);
  const meta = args.metaHash ?? { algo: 0, digest: new Uint8Array() };

  return signAndSubmit(wallet, sender, {
    function: `${MODULE}::create_order`,
    typeArguments: [],
    functionArguments: [
      args.warehouse,
      args.valueDeclared,
      args.storageFee,
      args.insuranceFee,
      args.paymentTxHash,
      hasMeta,
      meta.algo,
      meta.digest,
      args.clientCreatedAt,
    ],
  });
}

export async function checkIn(wallet: WalletClient, sender: string, args: CheckpointArgs) {
  return signAndSubmit(wallet, sender, {
    function: `${MODULE}::check_in`,
    typeArguments: [],
    functionArguments: [
      args.recordUid,
      utf8ToBytes(args.trackingNo),
      args.mediaHash.algo,
      args.mediaHash.digest,
      args.clientTs,
    ],
  });
}

export async function setInStorage(wallet: WalletClient, sender: string, recordUid: bigint, clientTs: bigint) {
  return signAndSubmit(wallet, sender, {
    function: `${MODULE}::set_in_storage`,
    typeArguments: [],
    functionArguments: [recordUid, clientTs],
  });
}

export async function checkOut(wallet: WalletClient, sender: string, args: CheckpointArgs) {
  return signAndSubmit(wallet, sender, {
    function: `${MODULE}::check_out`,
    typeArguments: [],
    functionArguments: [
      args.recordUid,
      utf8ToBytes(args.trackingNo),
      args.mediaHash.algo,
      args.mediaHash.digest,
      args.clientTs,
    ],
  });
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

export function utf8ToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

// 可选：封装媒体直传、哈希计算与 BFF commit
export async function uploadAndCommitMedia(
  file: File,
  presignUrl: string,
  commit: (params: { objectKey: string; hash: { algo: string; digest: string } }) => Promise<void>,
  hashFn: (file: File) => Promise<MediaHash>
) {
  const mediaHash = await hashFn(file);
  await fetch(presignUrl, { method: "PUT", body: file });
  await commit({
    objectKey: new URL(presignUrl).pathname,
    hash: { algo: String(mediaHash.algo), digest: bytesToHex(mediaHash.digest) },
  });
  return mediaHash;
}
```

---

## 6. BFF / Indexing (Read-only)

* **职责**：事件消费、聚合/搜索、统计排行、地图可视化、媒体预签名上传与元数据登记。
* **API（示例）**：

  * `POST /media/presign` → 返回对象存储直传凭证
  * `POST /media/commit` → 记录 object\_key/hash/algo/size/mime
  * `GET /orders`、`GET /orders/{uid}`、`GET /warehouses`、`GET /rankings`
* **技术**：Postgres（JSONB/GIN）、Redis（缓存）、消息队列（Kafka/SQS/Redis Stream）。
* **注意**：**不代签、不代付、不代理交易广播**。

### 6.1 Read-only BFF OpenAPI 3.1（含预签名、排行、搜索）

```yaml
openapi: 3.1.0
info:
  title: HaiGo Read API
  version: v0.1.0
  description: Read-only BFF for HaiGo dApp. All write operations go directly to Aptos.
servers:
  - url: https://api.haigo.dev
    description: Staging (Aptos Testnet)
  - url: https://api.haigo.app
    description: Production (Aptos Mainnet)
tags:
  - name: media
    description: Media presign & commit helpers
  - name: orders
    description: Read models for orders
  - name: warehouses
    description: Warehouse discovery and ranking
paths:
  /media/presign:
    post:
      tags: [media]
      summary: Issue presigned upload credential
      security: [{ ApiKeyAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/MediaPresignRequest'
      responses:
        '200':
          description: Presigned payload
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MediaPresignResponse'
        '403': { description: Forbidden - fails KYC/rate limiting }
  /media/commit:
    post:
      tags: [media]
      summary: Persist uploaded media metadata and optional attestation
      security: [{ ApiKeyAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/MediaCommitRequest'
      responses:
        '204': { description: Commit accepted }
        '409': { description: Duplicate object key or hash mismatch }
  /orders:
    get:
      tags: [orders]
      summary: List orders with optional filters
      parameters:
        - in: query
          name: status
          schema:
            type: string
            enum: [CREATED, IN, STORAGE, OUT]
        - in: query
          name: seller
          schema:
            type: string
            format: address
        - in: query
          name: warehouse
          schema:
            type: string
            format: address
        - in: query
          name: cursor
          schema:
            type: string
        - in: query
          name: limit
          schema:
            type: integer
            default: 20
            maximum: 100
      responses:
        '200':
          description: Paginated order summaries
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderListResponse'
  /orders/{record_uid}:
    get:
      tags: [orders]
      summary: Fetch a single order read model enriched from events
      parameters:
        - in: path
          name: record_uid
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Order detail
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderDetail'
        '404': { description: Order not found }
  /warehouses:
    get:
      tags: [warehouses]
      summary: Warehouse discovery listing
      parameters:
        - in: query
          name: region
          schema:
            type: string
        - in: query
          name: capacity_min
          schema:
            type: integer
        - in: query
          name: staking_min
          schema:
            type: integer
        - in: query
          name: sort
          schema:
            type: string
            enum: [rank, rating, staking, throughput]
      responses:
        '200':
          description: Warehouses
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/WarehouseListResponse'
  /rankings:
    get:
      tags: [warehouses]
      summary: Pre-computed rankings for leaderboard components
      parameters:
        - in: query
          name: dimension
          schema:
            type: string
            enum: [overall, speed, reliability, staking]
      responses:
        '200':
          description: Ranking buckets
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RankingResponse'
  /search:
    get:
      tags: [orders]
      summary: Full-text search across orders and warehouses
      parameters:
        - in: query
          name: q
          required: true
          schema:
            type: string
        - in: query
          name: type
          schema:
            type: string
            enum: [order, warehouse, mixed]
      responses:
        '200':
          description: Ranked search results with highlights
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SearchResponse'
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
  schemas:
    ContentHash:
      type: object
      properties:
        algo:
          type: string
          description: Hash algorithm identifier (e.g. blake3)
        digest:
          type: string
          description: Hex digest string
    MediaPresignRequest:
      type: object
      required: [objectKey, mime, size]
      properties:
        objectKey:
          type: string
        mime:
          type: string
        size:
          type: integer
        purpose:
          type: string
          enum: [order_in, order_out, warehouse_profile]
    MediaPresignResponse:
      type: object
      required: [uploadUrl, headers, expiresAt]
      properties:
        uploadUrl:
          type: string
        expiresAt:
          type: string
          format: date-time
        headers:
          type: object
          additionalProperties:
            type: string
    MediaCommitRequest:
      type: object
      required: [objectKey, hash]
      properties:
        objectKey:
          type: string
        hash:
          $ref: '#/components/schemas/ContentHash'
        size:
          type: integer
        mime:
          type: string
        uploader:
          type: string
          format: address
        orderUid:
          type: string
          nullable: true
    OrderListResponse:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/OrderSummary'
        nextCursor:
          type: string
          nullable: true
    OrderSummary:
      type: object
      properties:
        recordUid:
          type: string
        status:
          type: string
        seller:
          type: string
        warehouse:
          type: string
        createdAt:
          type: string
          format: date-time
        latestClientTs:
          type: string
          format: date-time
    OrderDetail:
      allOf:
        - $ref: '#/components/schemas/OrderSummary'
        - type: object
          properties:
            valueDeclared:
              type: integer
            storageFee:
              type: integer
            insuranceFee:
              type: integer
            checkIn:
              $ref: '#/components/schemas/LogisticsCheckpoint'
            inStorageAt:
              type: string
              format: date-time
              nullable: true
            checkOut:
              $ref: '#/components/schemas/LogisticsCheckpoint'
    LogisticsCheckpoint:
      type: object
      properties:
        trackingNo:
          type: string
        mediaHash:
          $ref: '#/components/schemas/ContentHash'
        clientTs:
          type: string
          format: date-time
    WarehouseListResponse:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/WarehouseSummary'
    WarehouseSummary:
      type: object
      properties:
        address:
          type: string
        region:
          type: string
        staking:
          type: integer
        rating:
          type: number
        capacity:
          type: integer
        serviceTags:
          type: array
          items:
            type: string
    RankingResponse:
      type: object
      properties:
        dimension:
          type: string
        buckets:
          type: array
          items:
            $ref: '#/components/schemas/RankingEntry'
    RankingEntry:
      type: object
      properties:
        warehouse:
          type: string
        score:
          type: number
        rank:
          type: integer
        stats:
          type: object
          additionalProperties:
            type: number
    SearchResponse:
      type: object
      properties:
        query:
          type: string
        results:
          type: array
          items:
            oneOf:
              - $ref: '#/components/schemas/OrderSummary'
              - $ref: '#/components/schemas/WarehouseSummary'
        tookMs:
          type: integer
```

---

## 7. Key Sequences

### 7.1 下单（ORDER\_CREATED）

1. Seller 在 Listing 选仓（BFF 列表 + 链上可用状态直查）
2. 若有媒体，前端直传 S3/MinIO 等对象存储 → 计算 `content_hash`
3. 调用 `create_order(...)`（钱包签名→直链）
4. 前端监听确认 & 显示结果；BFF 异步索引事件供列表/排行使用

### 7.2 入库（WAREHOUSE\_IN）

1. 仓主直传入库照片 → 计算 `in_media_hash`
2. 钱包直调 `check_in(record_uid, tracking_no, in_media_hash)`
3. 前端确认；BFF 更新读模型

### 7.3 仓储中（IN\_STORAGE）

1. 仓主钱包直调 `set_in_storage(record_uid)`
2. 前端确认；BFF 更新读模型

### 7.4 出库（WAREHOUSE\_OUT）

1. 仓主直传出库照片 → 计算 `out_media_hash`
2. 钱包直调 `check_out(record_uid, tracking_no, out_media_hash)`
3. 前端确认；BFF 更新读模型

---

## 8. Security, Privacy & Compliance

* **最小权限**：合约强约束权利人；前端限制合约地址白名单。
* **输入校验**：tracking\_no 长度、哈希长度与算法白名单、MIME/大小限制。
* **重放/越序**：`record_uid` 唯一、严格状态机、按钮防抖与重复提交拦截。
* **隐私**：PII 链下存储；仅摘要上链；审计日志与访问控制。
* **KYC/AML**：作为链下访问门槛（访问 BFF/对象存储时启用），不阻断链上交易（可配置开关）。
* **应急**：暂停开关（Pause），只读模式，公告与回滚预案。

---

## 9. Observability & Ops

* **指标**：交易成功/失败率、确认延迟；事件消费滞后；媒体哈希校验通过率；API QPS/错误率；缓存命中率。
* **日志**：结构化日志 + TraceID（前端→BFF→Indexer）；关键操作审计日志。
* **告警**：状态机异常（越序/重复）、消费积压、Hash 校验失败、费用飙升。
* **任务**：定期 hash 复核、冷数据归档、排行榜重算。

---

## 10. Performance & Cost

* **链上**：4 次状态写入/订单；事件 payload 精简（短字符串、定长哈希）。
* **BFF**：读多写少；Redis 缓存与分页；热门榜单物化视图。
* **媒体**：分辨率与压缩策略；S3 生命周期（标准→IA→Glacier）；多区域副本与成本控制。

---

## 11. Environments & Release

* **环境**：`dev`/`staging`/`prod`（Aptos testnet/mainnet）。
* **特性开关**：保险/质押、评分、KYC、暂停（Pause）。
* **灰度**：钱包白名单；前端 `env` 注入只读/读写模式；合约 `version` 升级策略。

---

## 12. CI/CD & Quality

* **合约**：Move 单测（状态机/权限/事件/错误码）、lint、gas 报告；testnet 自动部署、mainnet 人审。
* **BFF**：API 单测、契约测试、集成测试（事件回放）。
* **前端**：组件快照、E2E（Playwright/Cypress）、钱包模拟、弱网/失败重试测试。

---

## 13. Risks & Mitigation

* **索引延迟导致读写不一致** → 详情页直读链 + 乐观更新回滚。
* **媒体不可达/篡改** → 多副本 + 强制哈希比对 + 告警与重试。
* **恶意刷单/差评攻击** → 质押门槛 + 速率限制 + 信誉衰减模型。
* **跨境合规不确定** → 合规模块插件化，按市场逐步启用。

---

## 14. Milestones（与 PRD v1.2 对齐）

* **MVP（4–6 周）**：Move 状态机与事件、前端直链交互、媒体直传与哈希校验、BFF 列表与基础排行、监控与告警基线。
* **Beta（+6–8 周）**：保险理赔与评分全流、地图/排行榜增强、风控策略。
* **v1.0（+8–10 周）**：多资产与费率策略、合规/KYC、审计与主网发布。

---

## 15. Appendix – Interfaces Snapshot

**On-chain Entrypoints**：`create_order` / `check_in` / `set_in_storage` / `check_out`（+ stake/claim/rate 扩展）

**BFF（只读）API**：`/media/presign`、`/media/commit`、`/orders`、`/orders/{uid}`、`/warehouses`、`/rankings`、`/metrics`

**ContentHash（统一结构）**：`{ algo: "keccak256|blake3", digestHex: string, size: number, mime: string }`

**状态机**：`CREATED → IN → STORAGE → OUT`（每步均产生 Event 并写入区块）
