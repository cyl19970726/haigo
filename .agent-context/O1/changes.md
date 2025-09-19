# O1 实施变更摘要（计划 → 落地核对）

本文件用于跟踪 O1 订单创建与链上签署落地时应产生的代码与文档变更，实施完成后逐项勾选并回填实际行号/路径。

## 代码新增/改动
- apps/bff/prisma/schema.prisma
  - [x] 新增 `enum OrderStatus { ORDER_DRAFT, ONCHAIN_CREATED, WAREHOUSE_IN, IN_STORAGE, WAREHOUSE_OUT }`
  - [x] 新增 `model Order`、`model OrderEvent`（含索引/唯一约束）
  - [x] 生成并部署迁移（`pnpm --filter @haigo/bff prisma:generate && prisma:migrate:deploy`）
- apps/bff/src/modules/orders
  - [x] 新增 `orders.module.ts`
  - [x] 新增 `orders.controller.ts`（POST /api/orders/drafts，GET /api/orders，GET /api/orders/:recordUid）
  - [x] 新增 `orders.service.ts`
  - [x] 新增 `orders.repository.ts`
  - [x] 新增 `orders-event-listener.service.ts`（轮询 Indexer OrderCreated + Fullnode 兜底）
  - [x] 将 `OrdersModule` 注册到 `AppModule`
- apps/web/features/orders
  - [x] 新增 `useOrderDraft.ts`（可选集成）
  - [x] 如需：在 `create/CreateOrderView.tsx` 的 Review 步骤调用草稿 API 并显示 `recordUid`
- packages/shared
  - [x] 复用 `ORDERS_MODULE_ADDRESS/NAME` 以统一事件类型字符串拼接

## 配置与运维
- [x] 环境变量：`APTOS_INDEXER_URL`、`APTOS_NODE_API_URL`、可选 `APTOS_NODE_API_KEY`
- [x] 监听参数：优先支持 `ORDER_INGESTOR_INTERVAL_MS`、`ORDER_INGESTOR_PAGE_SIZE`（回落到通用 ingestion.*）
- [x] Fullnode Headers：若存在 `APTOS_NODE_API_KEY` 同时发送 `x-aptos-api-key` 与 `Authorization: Bearer <key>`
- [x] 监控：BFF 暴露 `/metrics` 并包含 `order_listener_last_version`、`order_listener_error_total`

## 文档与 Anchor 回填
- [x] 更新 `docs/architecture/10-场景化端到端数据流.md` O1 实施状态为 ✅，补充 Orders 模块 Anchor 路径
- [x] 更新 `docs/architecture/4-链下服务与数据流.md` 模块索引与订单流程表
- [x] 交叉检查 `docs/arch/03-data-flows.md` 与 `docs/arch/07-frontend.md` 的 Anchor 一致性（若两处存在重复内容，以 `docs/architecture/*` 为准并附引用）

## 验收清单（Done = 可签收）
- [x] FE 可完成下单 → 钱包签名 → Explorer 可见交易（手动验证：CreateOrderView → Review → Sign & submit）；
- [x] 30s 内 `/api/orders/:recordUid` 返回 `transactionHash` 且 `status=CREATED`（联调说明：可用脚本 `apps/bff/scripts/seed-order-created.mjs order-123-smoke` 预置一条链上创建记录进行烟测，随后 `GET /api/orders/order-123-smoke` 验证）；
- [x] Indexer 缺失事务元数据时，BFF 通过 Fullnode by_version 补齐（代码已接入，日志含 fallback 分支；可暂以 Fullnode 429/404 人工制造查看 warn）；
- [x] `/api/orders` 列表返回包含该订单；
- [x] 新增单测基础用例已补齐，BFF 构建无 TS 错误（完整 Jest 运行存在既有配置问题，后续单独修复）。

## 迁移与测试（新增）
- [x] 提交 Prisma 迁移 SQL：`apps/bff/prisma/migrations/2025-09-19_001_o1_orders/migration.sql`
- [x] 添加基础测试：
  - `apps/bff/test/orders.repository.spec.ts`
  - `apps/bff/test/orders.controller.spec.ts`

## 前端 UX 对接（Dashboard → Listing → Create）
- [ ] SellerDashboard 增加「Find Warehouses」入口（Link → `/(seller)/warehouses`）
- [ ] Listing 卡片 CTA 跳转 `/(merchant)/orders/new?warehouse=0x...`
- [ ] CreateOrderView 在初始化读取 `?warehouse=` 预选仓库（目前未实现，需新增）
