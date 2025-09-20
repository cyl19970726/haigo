# W2 Implementation Review

## Completion Snapshot
- ✅ BFF `GET /api/orders` 现已接受 `warehouse/status/page/pageSize` 并返回带 filters 的 meta（apps/bff/src/modules/orders/orders.controller.ts:64, apps/bff/src/modules/orders/types/list-summaries.ts:1）。
- ✅ 仓储层支持按仓库地址、状态过滤并执行 `createdAt desc` 分页，且聚合最新定价并做状态映射（apps/bff/src/modules/orders/orders.repository.ts:108, apps/bff/src/modules/orders/orders.repository.ts:155）。
- ✅ 前端提供 Dashboard 卡片与完整列表页，复用了同一 API 并实现分页/筛选/刷新（apps/web/features/orders/inbox/WarehouseOrdersCard.tsx:1, apps/web/features/orders/inbox/WarehouseOrdersView.tsx:1）。
- ✅ 指标输出包含新增的 inbox counters / latency，并透过 `/metrics` 暴露（apps/bff/src/modules/metrics/metrics.service.ts:9, apps/bff/src/modules/metrics/metrics.controller.ts:1）。
- ⚠️ Metrics 仅在 service 调用之后记录，查询参数校验抛错时未计入 error counter（apps/bff/src/modules/orders/orders.controller.ts:66）。
- ⚠️ Dashboard 卡片请求失败时静默回退为空态，未按规范展示 Alert 与重试指引（apps/web/features/orders/inbox/WarehouseOrdersCard.tsx:73）。
- ⚠️ `ORDER_STATUS_LABELS` 缺失 `PENDING` 标签，导致草稿状态仍显示英文枚举（packages/shared/src/config/orders.ts:57）。
- ⚠️ 新增查询/分页路径缺乏针对性单元测试；现有仓储测试仍只覆盖草稿创建与事件 upsert（apps/bff/test/orders.repository.spec.ts:76）。
- ✅ 文档补充了 W2 数据流、前端体验与数据流文件（docs/architecture/10-场景化端到端数据流.md:192, docs/front-end-spec.md:928, .agent-context/W2/data-stream.md:1）。

## Key Findings & Risks
1. **查询校验未记入错误指标** —— 由于 `parseListQuery` 在 `try/catch` 之前，一旦地址/状态无效将直接抛出 `BadRequestException` 且不会触发 `recordOrdersInboxError`，与计划中“非法参数需要记录”不符（apps/bff/src/modules/orders/orders.controller.ts:66）。
2. **Dashboard 卡片缺少错误态** —— 请求异常时仅写入日志并清空列表，用户看到的是“暂无订单”而非错误提示，违反前端规范中对错误态和重试 CTA 的要求（apps/web/features/orders/inbox/WarehouseOrdersCard.tsx:73）。
3. **草稿状态缺乏中文标签** —— `ORDER_STATUS_LABELS` 未覆盖 `PENDING`，导致 UI fallback 到英文枚举，影响一致性（packages/shared/src/config/orders.ts:57）。
4. **测试覆盖不足** —— 没有验证仓库/状态过滤、分页边界与 pricing fallback 的单元或集成测试，当前仓储测试仍使用过时的 mock 并忽略新功能（apps/bff/test/orders.repository.spec.ts:22, apps/bff/test/orders.repository.spec.ts:76）。

## Recommendations
1. 在 `OrdersController.list` 中将 metrics instrumentation 包裹整个流程，或于 `parseListQuery` 抛错路径显式调用 `recordOrdersInboxError` 以符合监控目标。（apps/bff/src/modules/orders/orders.controller.ts:66）
2. 为 `WarehouseOrdersCard` 增加错误状态展示与手动重试按钮，复用列表页的 Alert 模式保持 UX 一致。（apps/web/features/orders/inbox/WarehouseOrdersCard.tsx:73）
3. 补充 `ORDER_STATUS_LABELS.PENDING`（及可能的本地化文案），并确认卡片/列表引用中文标签。（packages/shared/src/config/orders.ts:57）
4. 扩充 BFF 层测试：为 `listSummaries` 添加过滤/分页/定价映射的 Prisma mock 场景，并在 controller 测试覆盖错误打点；必要时补充 FE 组件测试以覆盖错误/空态切换。（apps/bff/test/orders.controller.spec.ts:40, apps/bff/test/orders.repository.spec.ts:76）
