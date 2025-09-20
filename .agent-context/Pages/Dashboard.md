# Dashboard（Seller / Warehouse）— 规范对齐与可用性报告

本页核对 `.apps/web` 现有实现是否符合 `docs/architecture/5-前端体验.md` 的仪表盘规范，并逐一验证仪表盘内按钮可用性与数据从后端（BFF）获取的连通性。范围覆盖卖家与仓库两个 Dashboard。

## 摘要结论
- 仪表盘路由与会话守卫已就绪：`/dashboard/seller`、`/dashboard/warehouse` 存在，且 `apps/web/app/dashboard/layout.tsx:1` 使用服务端会话校验，未登录将重定向首页。
- Seller Dashboard 现状：部分符合规范。
  - 已实现：入口卡片“Find warehouses”跳转目录页；目录页支持筛选/分页；从目录进入下单向导可用。
  - 缺失：最近订单卡片（GET /api/orders?seller=…）、快捷入口（New Order / My Orders）、配置提示卡片。
- Warehouse Dashboard 现状：基本符合规范。
  - 已实现：订单收件箱（最近 5 条、Skeleton/错误态/空态）、跳转“查看全部订单”列表页、列表页筛选/分页/刷新。
  - 待补：质押/存储费卡片（GET /api/staking/:warehouseAddress）。
- 后端 API：BFF 已提供 `/api/warehouses`、`/api/orders`、`/api/orders/:recordUid`、`/api/staking/:warehouseAddress`，前端均已通过 `buildUrl()` 对接可用。

---

## 路由与容器
- `/dashboard/seller` → `apps/web/app/dashboard/seller/page.tsx:1`
- `/dashboard/warehouse` → `apps/web/app/dashboard/warehouse/page.tsx:1`
- 会话守卫（布局）：`apps/web/app/dashboard/layout.tsx:1` 使用 `loadSessionProfileFromServer()`，未登录 `redirect('/')`。

## Seller Cards（MVP）— 实现现状与核验
期望（规范）：
- 最近订单（GET `/api/orders?seller=…`）
- 快速下单 CTA（进入 CreateOrder 向导）
- 配置提示（缺少 `NEXT_PUBLIC_APTOS_NETWORK` / BFF URL 时的指示）

现状与按钮可用性：
- 已有卡片：Find warehouses
  - 页面：`apps/web/app/dashboard/seller/page.tsx:18`
  - 按钮：`Browse directory` → `href="/warehouses"`（存在路由 `apps/web/app/(seller)/warehouses/page.tsx:1`）
  - 数据：目录页使用 `useWarehouseDirectory()` → `fetchWarehouseDirectory()` → GET `/api/warehouses`（BFF 控制器存在，见下文）。
  - 目录页按钮：
    - `Previous` / `Next`（分页）调用 `setPage()`，触发重新请求，已可用。
    - `Retry`（错误态）调用 `refetch()`，已可用。
    - `Select warehouse` 跳转 `/orders/new?warehouse=0x…`（存在路由 `apps/web/app/(merchant)/orders/new/page.tsx:1`，加载 `CreateOrderView`）。
- 缺失卡片：
  - 最近订单：未见 Seller 侧卡片/视图（无 `SellerOrdersCard`）。建议新增基于 `fetchOrderSummaries({ sellerAddress })` 的组件。
  - 快捷入口：未见 “New Order / My Orders / Profile” 卡片。当前仅有订单创建页 `/orders/new`，无 “My Orders（卖家）” 列表路由。
  - 配置提示：未见根据 `NEXT_PUBLIC_BFF_URL` / `NEXT_PUBLIC_APTOS_NETWORK` 的告警提示。

## Warehouse Cards（MVP）— 实现现状与核验
- 订单收件箱卡片：已实现
  - 组件：`apps/web/features/orders/inbox/WarehouseOrdersCard.tsx:55`
  - 数据：`fetchOrderSummaries({ warehouseAddress, page:1, pageSize:5 })` → GET `/api/orders?warehouse=…`
  - 状态：连接态检测、Skeleton、错误态（Alert + 重试）、空态文案，均符合规范。
  - 按钮：
    - 列表项“查看详情” → `/(warehouse)/orders/[recordUid]/check-in`（存在路由 `apps/web/app/(warehouse)/orders/[recordUid]/check-in/page.tsx:1`）。
    - 卡片底部“查看全部订单” → `/(warehouse)/orders`（存在路由 `apps/web/app/(warehouse)/orders/page.tsx:1`）。
- 质押/存储费卡片：未实现（规范建议使用 GET `/api/staking/:warehouseAddress`）。可后续新增。

## 仓库订单列表页面（/(warehouse)/orders）— 实现核验
- 页面：`apps/web/app/(warehouse)/orders/page.tsx:1` → `WarehouseOrdersView`
- 视图：`apps/web/features/orders/inbox/WarehouseOrdersView.tsx:1`
  - 顶部刷新按钮：`onClick` → 触发当前页重新 `fetchOrderSummaries()`，可用。
  - 状态标签页：`ALL/PENDING/CREATED/WAREHOUSE_IN/IN_STORAGE/WAREHOUSE_OUT`，切换触发重新请求，符合规范。
  - 列表：shadcn Table，列顺序与规范一致（Order ID/Status/Total/Created/Txn/Action）。
  - 分页：`PaginationPrevious` / `PaginationNext` 计算边界并重新请求；底部文案包含总数与页码。
  - 未连接钱包：Alert 提示；错误态：Alert；加载：Skeleton 列表。均符合规范。
  - 查看详情：行内 `View` → `/(warehouse)/orders/[recordUid]/check-in`（存在）。

## 后端 API 与数据连通性
- 目录数据：
  - 前端：`apps/web/lib/api/directory.ts:1` → GET `/api/warehouses`（支持筛选/分页）
  - 后端：`apps/bff/src/modules/directory/directory.controller.ts:16` 提供 `/api/warehouses`，返回 `{ data, meta }`。
- 订单摘要与详情：
  - 前端：`apps/web/lib/api/orders.ts:72` `fetchOrderSummaries()` → GET `/api/orders`；`fetchOrderDetail()` → GET `/api/orders/:recordUid`
  - 后端：`apps/bff/src/modules/orders/orders.controller.ts:51` 提供 `/api/orders` 列表与 `/api/orders/:recordUid` 详情。
- 质押信息（待接入仓库卡片）：
  - 前端：`apps/web/lib/api/staking.ts:10` `fetchStakingIntent(address)` → GET `/api/staking/:warehouseAddress`
  - 后端：`apps/bff/src/modules/staking/staking.controller.ts:4` 提供 `/api/staking/:warehouseAddress`
- BFF 基础 URL：`apps/web/lib/api/client.ts:16` 使用 `NEXT_PUBLIC_BFF_URL`（可为空为同源），数据解析 `extractData()` 向后兼容 envelope 与纯数组。

## 按钮清单与可用性结论（Dashboard 范围）
- Seller Dashboard
  - `Browse directory` → `/warehouses`（存在）→ 目录页内：`Previous`/`Next`（分页）、`Retry`（错误重试）、`Select warehouse` → `/orders/new?warehouse=…`（存在）。均可用。
  - 缺失：`Recent Orders` 卡片内的“View/New Order”等按钮（卡片尚未实现）。
- Warehouse Dashboard
  - `查看全部订单` → `/(warehouse)/orders`（存在）。
  - 列表项 `查看详情` → `/(warehouse)/orders/[recordUid]/check-in`（存在）。
  - 列表页 `Refresh`（按钮）、`Tabs`（状态切换）、`PaginationPrevious` / `PaginationNext`（分页）均触发重新请求，可用。

## 与规范的差距与补全建议（优先级顺序）
1) Seller 最近订单卡片（高优先级）
   - 新增组件：`apps/web/features/orders/inbox/SellerOrdersCard.tsx`，逻辑复用 `WarehouseOrdersCard`，但过滤条件改为 `sellerAddress`。
   - 在 `apps/web/app/dashboard/seller/page.tsx` 网格中插入该卡片。
   - API：沿用 `fetchOrderSummaries({ sellerAddress, page:1, pageSize:5 })`。

2) Seller 快捷入口卡片（中优先级）
   - 提供按钮：`New Order` → `/orders/new`（已存在）；`My Orders` 可暂留置灰或跳转到计划中的 `/(merchant)/orders` 列表（当前未实现该列表页）。

3) Seller 配置提示卡片（中优先级）
   - 检测缺失配置：`process.env.NEXT_PUBLIC_BFF_URL`、`process.env.NEXT_PUBLIC_APTOS_NETWORK`；缺失时在卡片中使用 shadcn `Alert` 指示并给出文档链接。

4) Warehouse 质押/费率卡片（中优先级）
   - 新增卡片显示 `fetchStakingIntent(warehouseAddress)` 返回的 `stakedAmount`、`minRequired`、`feePerUnit`；提供 `View staking` 或后续 `Adjust fee` 入口（PoC 可只读）。

## 手动验收建议（Smoke）
- 连接不同角色钱包后访问 `/dashboard/{role}`：
  - Seller：点击 `Browse directory` → 目录页正常加载；选择任一仓库 → 跳转 `/orders/new?warehouse=…`，表单默认带入仓库地址。
  - Warehouse：卡片出现最近订单；点击“查看全部订单”进入列表；切换标签/翻页/刷新，均能重新加载数据；任一订单“查看详情”进入 `check-in` 页面加载详情。
- 断网或 BFF 停止：目录页与收件箱卡片出现错误 Alert，按钮 `Retry` 正常工作。
- 未连接钱包（仓库侧）：收件箱卡片提示先连接钱包。

## 结论
- 当前仓库侧 Dashboard 功能与数据接入基本达到规范；卖家侧仍需补齐“最近订单/快捷入口/配置提示”三项以全面满足 `docs/architecture/5-前端体验.md` 的格式与验收标准。

## 后端实现评审（合理性）
- 目录（/api/warehouses）
  - Controller 解析筛选/分页并返回 `{ data, meta }` 封装，合理。
  - Repository 合并账户+质押+费率+Hasura Profile，支持缓存与排序；分页在内存切片，PoC 可接受，后续建议下推到 SQL 以避免全量聚合。
- 订单（/api/orders, /api/orders/:recordUid, /api/orders/drafts, /api/orders/drafts/:recordUid/attach-tx）
  - 查询：地址格式校验、二选一的 seller/warehouse 过滤、状态白名单、分页上下界，合理。
  - 汇总映射：DB 枚举态 → 前端态（PENDING/CREATED/…）一致；`pricing` 优先事件数据，回落草稿，合理。
  - 详情：时间线基于 `order_events`，但仅映射 `OrderCreated→CREATED`，其它链上阶段暂记作 NOTE（见事件流小节）。
  - 草稿与交易绑定：`createDraft` 写入 payloadJson，`attach-tx` 绑定 `txn_hash`，监听器基于 hash 合并，合理且健壮。
- 媒体（/api/media/uploads）
  - Multer 内存存储 + 200MB 限制；MIME 白名单；BLAKE3 服务端重算并比对，合理。
  - 存储路径 `storage/media/{recordUid}/{stage}/{category}/filename`，字段落库完整。
  - 缺失：`POST /api/orders/:recordUid/media-verify`（前端已调用）。建议补一个轻量端点触发/模拟核验（返回 verifying/verified），并记录尝试次数与错误信息以丰富时间线。
- 质押（/api/staking/:warehouseAddress）
  - 读链上 view（get_stake/get_storage_fee），失败回落缓存，合理。
  - 可补：仓库 Dashboard 卡片读取此接口（前端待实现）。
- 指标与弹性
  - 目录/订单已打点；订单监听器有 last_version/error 指标与退避，合理。
  - 可补：媒体上传/核验成功率、大小分布，防滥用限流策略（上传/列表）。
- 安全与鉴权（PoC 现状）
  - 目前未对订单/媒体/目录加鉴权；PoC 可接受。后续建议：基于会话 Cookie 保护写接口（草稿/上传/核验/attach-tx），并加入速率限制与基础签名校验。

## 事件流评审（合理性）
- 卖家创建订单（已成链路）
  - FE：Review 步骤创建草稿 → 钱包签名 `create_order` → 拿到 `txnHash` → 调 `attachDraftTransaction` 绑定 → 轮询确认 → 试拉取 `GET /api/orders/:recordUid`。
  - BFF：`OrdersEventListener` 监听 `OrderCreated`（GraphQL）→ 通过 `by_version` 查 txn 元数据 → `applyOrderCreatedEvent` 合并草稿或回落按 `order-<id>-<hash>` 生成 `recordUid` → `orders` 与 `order_events` 落库。
  - 判定：链路闭环合理，一致性依赖索引器延迟，前端已做乐观态与兜底提示，符合预期。
- 仓库入库 Check-in（部分缺失）
  - FE：上传媒体（BLAKE3）→ 可触发“重新核验”`POST /api/orders/:recordUid/media-verify`（当前 BFF 缺失）→ 钱包签名 `check_in(order_id, logistics, category, mediaBytes)` → 轮询确认 → 期望时间线/状态进位。
  - BFF：监听器当前仅处理 `OrderCreated`，未处理 `CheckedIn/SetInStorage/CheckedOut` 三类事件；因此状态不会从 CREATED 进位，时间线也不会新增节点；核验端点缺失导致“重验”按钮失败。
  - 判定：需补全监听与端点才能完成“入库→在库→出库”的闭环。

## 改进建议（优先级）
- P0：扩展订单事件监听器
  - 新增处理 `ORDER_EVENT_TYPES.CHECKED_IN/SET_IN_STORAGE/CHECKED_OUT` 的查询与 `processEvent` 分支，映射到 DB：
    - `orders.status`：WAREHOUSE_IN/IN_STORAGE/WAREHOUSE_OUT
    - `order_events.type`：对应事件名，带上物流/媒体哈希等数据
  - `orders.repository.getDetail` 时间线映射上述事件为 `stage=WAREHOUSE_IN/IN_STORAGE/WAREHOUSE_OUT`（而非 NOTE）。
- P0：实现 `POST /api/orders/:recordUid/media-verify`
  - 请求体：`assetId?`、`hashValue`、`stage`、`category?`
  - 行为：写入一条“核验中/核验结果”记录（或更新 MediaAsset 字段 `matchedOffchain/verificationStatus/attempts/lastVerificationAt`），立即返回 `{ status: 'verifying' }`；后台任务（或定时器）可将其置为 `verified/failed`。
- P1：Seller “最近订单” 卡片
  - 复用 `fetchOrderSummaries({ sellerAddress, page:1, pageSize:5 })`，补齐卖家 Dashboard 规范。
- P1：仓库质押/费率卡片
  - 读取 `/api/staking/:warehouseAddress`，展示 `stakedAmount/minRequired/feePerUnit`。
- P2：一致性与易用性
  - `orders.repository.listSummaries` 的 `createdAt/updatedAt` 优先使用 `chainTimestamp`（存在时）以更符合链上时间。
  - `CreateOrderView` 可选读取 BFF 返回的 `signPayload` 以减少前端函数参数重复拼装风险（两边保持一致）。
  - 媒体大小策略：细分并校验不同 MIME 的大小上限（IMAGE 15MB/VIDEO 200MB/DOC 10MB），与前端文案一致。
  - 上传存储：内存存储适合 PoC，后续改为磁盘/对象存储与流式哈希，避免大文件占用内存。
- P2：鉴权与配额
  - 对写接口（草稿、上传、核验、attach-tx）要求会话 Cookie；结合基础速率限制、请求体大小限制与防刷策略。

## 结论（后端与事件流）
- 卖家侧从“草稿→上链→索引→合并”闭环已合理可用。
- 仓库侧“入库→核验→在库/出库”链路的后端监听与核验端点尚未补全，导致状态无法进位与按钮失败。按上方 P0 优先级补齐后，Dashboard 的数据与交互将与规范完全对齐。
