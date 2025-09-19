# W2 — 仓库订单收件箱（可见性）实施计划（合并版：需求→文档→设计→实现→Checklist→文档更新）

> 场景：被下单的家庭仓可在“订单收件箱”看到属于自己的订单，按状态分组（CREATED/WAREHOUSE_IN/IN_STORAGE/WAREHOUSE_OUT），用于后续入库/出库（O2）。与 O1/L1 的状态、定价、UI 一致。
> 场景表定位：docs/architecture/10-场景化端到端数据流.md:10.7

## 一、功能需求（Functional Requirements）
- 仓库可按时间降序查看针对自身地址的订单列表；可选按状态筛选与分页。
- 状态与文案对齐 O1：`ORDER_DRAFT→PENDING`、`ONCHAIN_CREATED→CREATED`、其余同名。
- 定价展示对齐 O1：草稿取 `payloadJson.pricing`；上链取最近一次 `OrderCreated.data.pricing`（回退 payload）。
- FE 入口：仓库 Dashboard 卡片（最近 N 条），完整页（可选）提供状态 Tabs 与分页；点击至订单详情。

## 二、必读文档（Must‑Read）
- O1：.agent-context/O1/O1-implementation-plan.md、.agent-context/O1/Review.md
- 模板：.agent-context/Plan-Template.md、.agent-context/templates/DataStream-Template.md
- 架构：docs/architecture/10-场景化端到端数据流.md（10.6/10.7/10.8）、docs/architecture/4-链下服务与数据流.md
- 前端：docs/architecture/5-前端体验.md、docs/front-end-spec.md（Warehouse Inbox 设计：`docs/front-end-spec.md:928`、`docs/front-end-spec.md:944`、`docs/front-end-spec.md:956`、`docs/front-end-spec.md:968`）
- 共享：packages/shared/src/dto/orders.ts、packages/shared/src/config/orders.ts

## 三、完整代码设计（Complete Code Design）

1) BFF API 契约（对齐 O1）
- 列表：GET `/api/orders`
  - 查询参数（互斥）：
    - `seller=0x...` 或 `warehouse=0x...`
  - 可选参数：
    - `status=CREATED|WAREHOUSE_IN|IN_STORAGE|WAREHOUSE_OUT|PENDING`
    - `page=1`、`pageSize=20`（上限 100）
  - 响应：`OrderSummaryDto[]`
- 可选聚合：GET `/api/orders/summary?warehouse=0x...` → `{ counts: Record<status, number> }`

2) Repository 查询与映射
- 过滤：`warehouseAddress`（统一小写 0x），可选 `status`（使用 O1 相同映射器）。
- 排序：`createdAt desc`；分页：`skip/take`。
- 定价：草稿→`payloadJson.pricing`；上链→最新 `OrderCreated.data.pricing`（回退 payload）。

3) 状态/定价映射（与 O1 保持一致）
- 状态映射：
  - `ORDER_DRAFT -> PENDING`
  - `ONCHAIN_CREATED -> CREATED`
  - `WAREHOUSE_IN/IN_STORAGE/WAREHOUSE_OUT -> 同名`
- 定价映射：见上，单位统一使用 subunits（precision=OCTA_PER_APT）。

4) 安全与校验
- 参数校验：`warehouse`/`seller` 必须匹配 `^0x[0-9a-fA-F]+$`；`pageSize<=100`。
- 速率限制：可按路由层做轻量限流（非强制）。

5) 可观测性
- 指标：
  - `orders_inbox_request_total`（counter）
  - `orders_inbox_request_latency_ms`（gauge/histogram 近似）
- 日志：记录非法参数/查询错误；与 O1 共享 `/metrics` 暴露。

6) 前端集成（与 L1/O1 一致的 UI 组件）
- Dashboard 卡片：`apps/web/app/dashboard/warehouse/page.tsx`
- 完整页（可选）：`apps/web/app/(warehouse)/orders/page.tsx`
- 列表容器：`apps/web/features/orders/inbox/WarehouseOrders.tsx`
- 使用 ShadCN 组件（card/table/badge/tabs/skeleton/pagination/alert/button）。
 - 参考 UX 规范：`docs/front-end-spec.md:928`（Warehouse Cards – 订单收件箱）、`docs/front-end-spec.md:944`（Dashboard ASCII）、`docs/front-end-spec.md:956`（Orders Inbox 块）、`docs/front-end-spec.md:968`（说明与 CTA）

7) Anchors（实现位置）
- 后端：
  - `apps/bff/src/modules/orders/orders.controller.ts`
  - `apps/bff/src/modules/orders/orders.service.ts`
  - `apps/bff/src/modules/orders/orders.repository.ts`
- 前端：
  - `apps/web/app/dashboard/warehouse/page.tsx`
  - `apps/web/app/(warehouse)/orders/page.tsx`
  - `apps/web/features/orders/inbox/WarehouseOrders.tsx`
- 共享类型：`packages/shared/src/dto/orders.ts`、`packages/shared/src/config/orders.ts`

## 四、实现计划（Step‑by‑Step）
1. BFF 控制器
   - 扩展 `OrdersController.list` 解析 `warehouse/status/page/pageSize` 参数（与 `seller` 互斥），参数校验。
2. BFF 服务/仓储
   - `OrdersService.listSummaries({ sellerAddress?, warehouseAddress?, status?, page?, pageSize? })`
   - `OrdersRepository.listSummaries` 增加 warehouse/status 过滤与分页；复用 O1 的状态/定价映射辅助函数。
   - 可选新增 `getStatusSummaryByWarehouse(warehouse)` 聚合。
3. 指标与日志
   - 在控制器入口计数/记录耗时，输出至 `MetricsService`。
4. 前端
   - Dashboard 卡片：最近 N 条（链接详情/完整页）。
   - 完整页：状态 Tabs、分页、空态/错误态；调用相同 API。
   - 按 UX 文档实现文案与交互（参考：`docs/front-end-spec.md:928`、`docs/front-end-spec.md:944`、`docs/front-end-spec.md:956`、`docs/front-end-spec.md:968`）。
5. 测试
   - 单元：repo 过滤/分页/映射；
   - 集成：controller 参数校验与响应；
   - E2E：种子数据 + 仓库看见 CREATED 订单；
6. 文档回填
   - 更新 10.7 与 4 章锚点；前端规范补充 Inbox 卡片。

## 五、Checklist（执行核对）
- [ ] 控制器支持 `?warehouse/status/page/pageSize`，参数互斥校验 seller/warehouse
- [ ] Repository 按 warehouse/status 过滤、`createdAt desc`、分页
- [ ] 状态/定价映射与 O1 一致
- [ ] 指标埋点加入 `/metrics`
- [ ] FE Dashboard 卡片/完整页（可选）对接完成
- [ ] 单元/集成/E2E 测试通过
- [ ] 文档锚点更新

## 六、是否需要更新对应文档（Docs Updates）
- docs/architecture/10-场景化端到端数据流.md：10.7 标注 ✅ 与 Anchors
- docs/architecture/4-链下服务与数据流.md：Orders 模块表增加 W2 列
- docs/architecture/5-前端体验.md：Warehouse Dashboard/Inbox 卡片描述与路径
- docs/front-end-spec.md：若实现过程中有交互/文案细节差异，更新 Warehouse Inbox 小节（锚点：`docs/front-end-spec.md:928`、`docs/front-end-spec.md:944`、`docs/front-end-spec.md:956`、`docs/front-end-spec.md:968`）
- .agent-context/W2/data-stream.md：补充 W2 专属时序（基于模板），标注依赖 O1 监听器新鲜度

## 七、实现后 Review 指南（Post‑Implementation Review）
- 功能：指定 `warehouse=0x...` 能返回 CREATED 订单；状态/定价和详情一致；分页/筛选正确。
- 性能：分页生效，响应时间与查询计划正常（必要时加复合索引）。
- 观测：`orders_inbox_request_total` 增长、`orders_inbox_request_latency_ms` 合理。
- 安全：参数校验生效，`pageSize` 上限，错误码语义明确。
