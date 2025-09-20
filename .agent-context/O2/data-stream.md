# O2 仓储出库与媒体上传 — 数据流与时序图

> 描述仓库在处理订单出库时的端到端数据流：媒体上传 → 签署出库 → 事件回放 → 时间线与媒体对账。

## 1. 总体时序（E2E）
```mermaid
sequenceDiagram
  autonumber
  participant FE as FE (OrderCheckOutView)
  participant BFF as BFF::Media/Orders
  participant DB as Postgres
  participant Wallet as Wallet
  participant Move as Move::orders
  participant Indexer as Aptos Indexer (GraphQL)
  participant Fullnode as Aptos Fullnode (REST)

  Note over FE: 出库前上传出库媒体以获得哈希
  FE->>BFF: POST /api/media/uploads {recordUid, stage=outbound, ...}
  BFF->>DB: INSERT media_assets
  BFF-->>FE: { recordUid, stage, category, hash.value }

  Note over FE,Wallet: 用户点击 Sign & submit 出库
  FE->>Wallet: 构建并签名 orders::check_out(order_id, logistics_outbound, media_hash)
  Wallet->>Move: submit check_out
  Move-->>Indexer: emit CheckedOut {order_id, logistics_outbound, media{stage,category,hash,...}}

  loop Polling (with backoff)
    BFF->>Indexer: GraphQL events(type IN [CheckedIn, SetInStorage, CheckedOut], cursor)
    Indexer-->>BFF: events[ {transaction_version, event_index, type, data} ]
    alt Indexer缺少txn哈希/时间戳
      BFF->>Fullnode: GET /transactions/by_version/{version}
      Fullnode-->>BFF: {hash, timestamp}
    end
    BFF->>DB: UPSERT order_events(type, cursor, data)
  end

  Note over BFF,DB: 对账媒体哈希
  BFF-->>DB: UPDATE media_assets SET matched_offchain=true WHERE record_uid=:uid AND hash_value = event.media.hash

  FE->>BFF: GET /api/orders/:recordUid
  BFF-->>FE: 订单详情（状态+时间线+mediaAssets{matchedOffchain}）
```

## 2. 锚点与契约
- BFF
  - media.controller.ts / media.service.ts：媒体上传接口及入库（含 BLAKE3 计算）
  - orders-event-listener.service.ts：监听 `CheckedIn|SetInStorage|CheckedOut` 并落表
  - orders.repository.ts：`getDetail` 汇总 `timeline` 与 `mediaAssets`，并可设置 matchedOffchain
- 前端
  - features/orders/inbound/OrderCheckInView.tsx（已存在）
  - features/orders/outbound/OrderCheckOutView.tsx（planned）
  - 路由：`/(warehouse)/orders/[recordUid]/check-in` 与 `/(warehouse)/orders/[recordUid]/check-out`
- 链上
  - move/sources/orders.move：`check_in/set_in_storage/check_out` 与 `CheckedIn/SetInStorage/CheckedOut`

## 3. 字段映射
- order_events.data（按事件）：
  - CheckedIn: { logistics_inbound, media: { stage, category, hash } }
  - SetInStorage: { media: { stage, category, hash } }
  - CheckedOut: { logistics_outbound, media: { stage, category, hash } }
- media_assets：{ record_uid, stage, category, hash_value, uploaded_at, ... }
- 对账规则：`media_assets.hash_value`（hex） == `event.media.hash`（hex） → matchedOffchain=true

## 4. 兜底与退避
- Indexer → Fullnode by_version 兜底 txn hash/timestamp；请求头同时携带 `x-aptos-api-key` 与 `Authorization: Bearer <key>`（若配置）
- 429/timeout/backoff：与 O1/W1 监听器一致

## 5. 验收要点
- 上传媒体 → 出库签署 → ≤30s 内时间线出现 CheckedOut 条目
- 媒体对账标记 matchedOffchain=true；当缺少 media 或 hash 不一致时记录告警
- /api/orders/:recordUid 返回 timeline+mediaAssets，可作为 W2 收件箱详情的来源

```text
备注：若未来拆分 /api/orders/:recordUid/timeline 端点，仅为视图按需拆分，非功能依赖。
```

