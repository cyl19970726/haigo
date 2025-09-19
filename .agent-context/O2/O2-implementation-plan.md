# O2 仓储出库与媒体上传 — 完整实现计划（Design → Steps → Tests）

> 场景：被选择的家庭仓在处理订单时，上传物流/出库媒体并在链上完成出库签署；链下回放时间线并对账媒体哈希。
>
> 关联文档：docs/architecture/10-场景化端到端数据流.md:10.8、docs/architecture/4-链下服务与数据流.md

## 1. 目标与交付物
- 前端：出库页面与表单（物流号、可选备注），支持媒体上传（图片/视频/PDF），时间线回显。
- 后端：媒体上传 API 复用 MediaModule；Orders 监听器扩展 CheckedIn/SetInStorage/CheckedOut；时间线查询接口。
- 数据：order_events 追加三类事件；media_assets 与 order_events 按 record_uid 对账并标记 matchedOffchain。
- 验收：出库链路端到端完成；缺元数据时 Fullnode 兜底；时间线与媒体一致。

## 2. 跨层契约
- FE
  - POST /api/media/uploads → 返回 {recordUid, stage, category, hash.value}
  - Wallet 签署：orders::check_out(order_id, logistics_outbound, media_hash)
  - GET /api/orders/:recordUid (/timeline 可选) → 渲染时间线 + 媒体缩略
- BFF
  - MediaController/Service 已有（apps/bff/src/modules/media/*）
  - OrdersEventListener：新增解析 CheckedIn/SetInStorage/CheckedOut；Fullnode by_version 兜底
  - OrdersTimelineService（新增）：聚合 order_events + media_assets
- Move
  - 复用 haigo::orders 中 check_in/set_in_storage/check_out 与对应事件

## 3. 实施步骤
1) 数据层
- 确认 order_events 已具字段（type、txn_version、event_index、data）可容纳三类事件；如需扩充 data 字段结构在 Repository 层做映射。

2) BFF 监听与时间线
- 扩展 OrdersEventListener：
  - 解析 `CheckedIn`/`SetInStorage`/`CheckedOut`，入库 order_events；
  - 若 Indexer 无哈希/时间戳，通过 Fullnode by_version 兜底；
  - 将 `media_hash` 写入 event.data，供对账使用。
- 新增 OrdersTimelineService：
  - API：GET /api/orders/:recordUid/timeline → {timeline[], mediaAssets[]}
  - 对账：media_assets.hash_value == event.media.hash → matchedOffchain=true

3) 前端页面与调用
- 新增 features/orders/outbound/OrderCheckOutView.tsx（或在仓库订单详情页中提供出库流程）
- 复用 apps/web/lib/api/media.ts 上传，随后签名 check_out；
- 成功后轮询 GET /api/orders/:recordUid 或 timeline 接口。

4) 观测与补偿
- 指标：`order_listener_last_version`、`order_listener_error_total` 持续可用；
- 预留补偿任务：回扫缺失哈希与未匹配媒体（后续 Story）。

## 4. 测试计划
- 单元：
  - listener 解析三类事件，哈希/时间戳兜底分支；
  - timeline 聚合逻辑；
- 集成：
  - 媒体上传→签名→回放→时间线可见；
- 前端：
  - 表单校验、上传/签名 happy path、时间线渲染；

## 5. 验收标准
- 出库流程完成后，/api/orders/:recordUid 返回状态推进与 transactionHash；
- timeline 中含 CheckedIn/SetInStorage/CheckedOut 并对账媒体为 matchedOffchain=true；
- Fullnode 兜底在 Indexer 缺失时生效（warn 日志可见）；
