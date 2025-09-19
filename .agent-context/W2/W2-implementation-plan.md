# W2 — 仓库订单收件箱（可见性）实施计划（Design → Steps → Tests）

> 场景：被下单的家庭仓能够在“订单收件箱”页面看到属于自己的订单（按状态分组：待处理/在库/已出库），用于后续入库/出库（O2）。
>
> 场景表定位：docs/architecture/10-场景化端到端数据流.md:10.7

## 0. 上下文与需阅读文档
- 场景数据流：docs/architecture/10-场景化端到端数据流.md（10.6 O1 → 10.7 W2 → 10.8 O2）
- 链下服务：docs/architecture/4-链下服务与数据流.md（Orders 模块已初版）
- 前端：docs/front-end-spec.md（Warehouse Dashboard ASCII；Orders Inbox 卡片）
- 共享类型：packages/shared/src/dto/orders.ts（OrderSummaryDto/Status）；packages/shared/src/config/orders.ts（状态文案）

## 1. 目标与交付物
- BFF：扩展 Orders 列表支持按 `warehouseAddress` 过滤（GET `/api/orders?warehouse=0x...`）与状态聚合。
- FE：WarehouseOrders 页面与卡片（或 Dashboard 卡片简版），显示过滤后的订单列表，按状态分组与时间戳排序。
- 数据：复用 `orders` 表与 `order_events`；无新表。

## 2. 跨层契约与 Anchors
- BFF Anchors（已存在 + planned 扩展）
  - apps/bff/src/modules/orders/orders.controller.ts: GET `/api/orders?seller=0x...` 与 `/api/orders?warehouse=0x...`（两者择一传入）
  - apps/bff/src/modules/orders/orders.service.ts: `listSummaries({ sellerAddress?, warehouseAddress? })`
  - apps/bff/src/modules/orders/orders.repository.ts: `listSummaries({ sellerAddress?, warehouseAddress? })`
- FE Anchors（planned）
  - apps/web/app/dashboard/warehouse/page.tsx（Inbox 卡片）
  - apps/web/app/(warehouse)/orders/page.tsx（收件箱完整页，optional）
  - apps/web/features/orders/inbox/WarehouseOrders.tsx（列表容器）
  - UI 组件（ShadCN MCP）：列表/卡片/标签/分页/空态与加载态使用 ShadCN，通过 MCP 拉取 `card`、`table`、`badge`、`tabs`、`skeleton`、`alert`、`pagination`、`button` 等组件。

## 3. 共享类型（Share Types & DTO Index）
- packages/shared/src/dto/orders.ts → `OrderSummaryDto`（recordUid/orderId/status/createdAt/transactionHash）
- packages/shared/src/config/orders.ts → `ORDER_STATUS_LABELS`

## 4. 实施步骤
1) BFF：
- 扩展 OrdersController.list 读取 `warehouse` query 并传递到 service/repo；
- OrdersRepository.listSummaries 支持按 warehouseAddress 过滤，并按 createdAt desc；
- 可选：提供状态聚合统计（counts by status）。

2) 前端：
- Dashboard Inbox 卡片：读取 GET `/api/orders?warehouse=...` 显示最近 N 条；
- 完整页面：分页/过滤（按状态），点击进入订单详情；

3) 文档：
- 10.7 小节回填 anchors（BFF/FE）；front-end-spec 的 Inbox 卡片描述与链接；

## 5. 测试计划
- 单元：repository 过滤逻辑与排序；controller 参数校验；
- 集成：GET `/api/orders?warehouse=...` → 返回列表；
- 前端：卡片渲染/空态/错误态；

## 6. 验收标准
- 仓库能看到属于自己的订单列表；
- 列表按时间降序，状态显示正确；
- 从卡片可进入详情或后续 O2 操作；
