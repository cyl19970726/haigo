# L1 代码实现 Review（Directory：仓库 Listing）

结论（TL;DR）
- 基本满足 L1 目标：BFF 提供 `/api/warehouses`，聚合 Prisma + Hasura，返回 `data+meta`；Web 端实现目录页、筛选/排序、CTA 到下单页，O1 能读取 `?warehouse=` 预选仓库。
- 测试覆盖关键路径（缓存命中/回退、参数解析、组件渲染）。监控指标已接入（/metrics）。
- 与实施计划的小偏差：分页目前在内存侧进行；`q` 搜索未覆盖 Hasura 的 `name`/`serviceAreas`；可作为优化项，不阻断 L1 交付。

## 覆盖范围与实现定位
- BFF 模块
  - `apps/bff/src/modules/directory/directory.module.ts:1` 注册到 `AppModule`，依赖 Prisma + Metrics。
  - 控制器 `apps/bff/src/modules/directory/directory.controller.ts:1` 暴露 `GET /api/warehouses`，解析 `available|minScore|maxFeeBps|area|q|sort|page|pageSize`，返回 `{ data, meta }`（含 `page|pageSize|total|generatedAt|cacheHit`），与前端兼容。
  - 服务 `apps/bff/src/modules/directory/directory.service.ts:1` 记录指标，转发到仓储层。
  - 仓储 `apps/bff/src/modules/directory/directory.repository.ts:1` 聚合：`accounts` + `staking_positions` + `storage_fees_cache` + `Hasura warehouse_profiles`，实现筛选/排序/缓存/分页（内存切片）。
  - Hasura `apps/bff/src/modules/directory/hasura.client.ts:1` 可选增强，失败降级并记录 warn。
- FE 模块
  - Hook `apps/web/features/directory/useWarehouseDirectory.ts:1` 管理筛选/分页/状态，调用 `apps/web/lib/api/directory.ts:1`；使用 `DEFAULT_DIRECTORY_PAGE_SIZE=12`。
  - 页面 `apps/web/app/(seller)/warehouses/page.tsx:1` 渲染 Filters、卡片网格、分页与状态。
  - 卡片 `apps/web/features/directory/WarehouseCard.tsx:1` 展示评分、容量、费率、区域、CTA（`/orders/new?warehouse=…`）。
  - O1 预选：`apps/web/features/orders/create/CreateOrderView.tsx:1` 读取 `?warehouse=` 并预选仓库。

## 与实施计划/验收标准的符合性
- API 形态
  - 返回 `{ data, meta }`（未使用 `{ items }`）符合 changes.md 要求；`apps/web/lib/api/directory.ts:1` 与 `apps/web/lib/api/orders.ts:1` 都能兼容 envelope 或数组。
  - Meta 含 `page|pageSize|total|generatedAt|cacheHit`，与 Testing.md 验收项一致。
- 数据源与聚合
  - 读取 Prisma 表：`accounts`、`staking_positions`、`storage_fees_cache`；从 Hasura 取 `warehouse_profiles`（name/credit/areas/last_audit_at）。
  - 计算字段：`stakingScore`（信用分或由质押推导）、`creditCapacity`、`availability`（无 profile 时由质押推断）、`feePerUnit`、`lastAuditAt`；与 L1 设计一致。
- 筛选/排序
  - 实现了 `available|minScore|maxFeeBps|area` 过滤与 `score_desc|fee_asc|capacity_desc|recent` 排序。
  - 差异：`q` 搜索仅在 DB 层针对 `accountAddress/profileUri` 预过滤，未覆盖合并后的 `name/serviceAreas`；与设计文档“q 匹配名称/地址/区域”存在偏差（建议项见下）。
- 分页与缓存
  - 采用内存 TTL 缓存（默认 30s，可配 `DIRECTORY_CACHE_TTL_MS`）；缓存键包含筛选+分页；命中标记在 meta 返回并计入指标。
  - 分页在仓储层“先聚合后过滤排序再切片”，未按计划在 DB 层 `take/skip`（仅 accounts 查询做了 where/q，但未在 SQL 层分页）。PoC 可接受，但大规模数据需要优化。
- 前端体验
  - 目录页、筛选器、卡片、分页 UI 状态完整；CTA 跳转并被 O1 识别预选。
  - Hook/Fetch 兼容 `{ data, meta }` 或数组，错误/加载态处理完善。
- 测试与指标
  - BFF：`directory.repository.spec.ts` 覆盖缓存命中、Hasura 回退、过滤；`directory.controller.spec.ts` 覆盖参数解析与默认值。
  - Web：`WarehouseCard.test.tsx` 基本渲染/CTA 断言；Hook 亦有测试文件。
  - 指标：`/metrics` 暴露 `directory_*` 计数与延迟；与 Testing.md 对齐。

## 发现的问题与改进建议
1) `q` 搜索覆盖不完整（建议优先级：高）
   - 现状：仅在 Prisma `Account` 层对 `accountAddress|profileUri` 做 contains；合并后的 `name`（来自 Hasura）与 `serviceAreas` 未参与模糊匹配。
   - 影响：按名称/区域搜索可能无结果或不准确，偏离设计预期。
   - 建议：在 `applyFilters` 中补充：
     - 对 `item.name?.toLowerCase().includes(q)`
     - 对 `item.address.includes(q)`（已通过 DB 层预过滤部分覆盖）
     - 对 `item.serviceAreas?.some(a => a.toLowerCase().includes(q))`

2) 分页位置与可扩展性（建议优先级：中）
   - 现状：内存分页，`accounts` 全量取回后联表过滤；小数据集没问题，但扩展性有限。
   - 建议：
     - 第一阶段：保留现逻辑但将缓存键拆分为“参数键”和“页键”，缓存未分页的 `sorted` 结果，分页仅切片，提升跨页命中率。
     - 第二阶段：根据实际规模将“可 DB 化”的条件（`q`、`role`、必要时 `createdAt`）下推到 SQL，并在仓储侧仅做 Hasura 增强与次级过滤。

3) `available` 默认值（建议优先级：中）
   - 现状：Controller 对 `available` 未指定时传 `undefined`；Repository 规范化为 `false`，即默认不过滤不可用仓。
   - 评估：FE 目录页默认传 `available=true`，但 O1 的 `fetchWarehouses()` 不带过滤，可能出现“未质押/limited”仓库。
   - 建议：若业务期望仅返回可用仓作为下单候选，可将 Repository 默认改为 `true` 或在 O1 fetch 层追加 `?available=true`。

4) 性能可见性与保护（建议优先级：中）
   - 现状：单次请求 3 次查询 + 可选 Hasura GraphQL，缓存 TTL=30s；大多情况足够。
   - 建议：
     - 增加每次聚合行数上限（保护阈值日志/指标）。
     - 将 `addresses` 为空、Hasura 返回 4xx/5xx 的情况计入错误指标维度标签（如错误类型）。

5) 细节一致性与健壮性（建议优先级：低）
   - `serviceAreas` 大小写：过滤时统一 `toLowerCase()` 已处理，但建议在 HasuraClient 取回时也统一为小写，减少重复转换。
   - `formatBps` 显示：前端展示做了百分比换算，符合预期；若后续费率来源统一为 bps，场景文案可统一“费率（%）/（bps）”。

## 建议的最小修复（供采纳）
- 在 `apps/bff/src/modules/directory/directory.repository.ts` 的 `applyFilters` 中插入对 `q` 的二次匹配（name/address/serviceAreas）。
- 在 `apps/web/lib/api/orders.ts:1` 的 `fetchWarehouses` 追加 `?available=true`（如业务希望仅展示可选仓）；或在 Repository `normalizeOptions` 将 `available` 默认改为 `true`（需确认其它调用方影响）。
- 若希望提升缓存命中率：将缓存内容改为“未分页结果 + 分页切片”，缓存键拆分，避免相同参数只因页码不同而重复聚合。

## 验收核对（抽样）
- `/api/warehouses` 支持筛选/排序/分页，Hasura 故障回退正常；返回 `{ data, meta }`。
- Seller 目录页可筛选并展示卡片，CTA 正常跳转到 `/orders/new?warehouse=…`。
- O1 `CreateOrderView` 能读取并预选仓库。
- 指标 `/metrics` 暴露 `directory_*` 计数与延迟；单测通过。

## 参考文件
- API 控制器：`apps/bff/src/modules/directory/directory.controller.ts:1`
- 仓储聚合：`apps/bff/src/modules/directory/directory.repository.ts:1`
- Hasura 客户端：`apps/bff/src/modules/directory/hasura.client.ts:1`
- FE Hook：`apps/web/features/directory/useWarehouseDirectory.ts:1`
- FE API：`apps/web/lib/api/directory.ts:1`
- 页面：`apps/web/app/(seller)/warehouses/page.tsx:1`
- 卡片：`apps/web/features/directory/WarehouseCard.tsx:1`
- O1 预选：`apps/web/features/orders/create/CreateOrderView.tsx:1`

—— 评审完成。如需，我可以直接补上 `q` 二次过滤与缓存键优化的小改动，并补增对应单测。

## 已按评审完成的轻量修改（PoC）
- BFF：扩展 `q` 过滤，改为在聚合后对 `name/address/serviceAreas` 做包含匹配；对应修改：`apps/bff/src/modules/directory/directory.repository.ts:1`（移除 Prisma 层 q 过滤，新增 applyFilters 的 q 匹配）。
- FE（O1 依赖）：下单流程仅获取可用仓库，`apps/web/lib/api/orders.ts:1` 的 `fetchWarehouses()` 改为请求 `/api/warehouses?available=true`。
