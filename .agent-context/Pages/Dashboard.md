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
