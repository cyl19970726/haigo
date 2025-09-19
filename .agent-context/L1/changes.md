# L1 变更摘要与验收（联动 W1/O1）

## 代码（BFF）
- [ ] 新增 `apps/bff/src/modules/directory/*`（Module/Controller/Service/Repository）并注册到 `AppModule`
- [ ] Controller 返回结构与 FE 兼容：返回 `WarehouseSummary[]` 或 `{ data: WarehouseSummary[] }`（不可返回 `{ items: [] }`）
- [ ] Repository 直接读取 Prisma 表：`staking_positions`、`storage_fees_cache`，聚合为 `WarehouseSummary`（可选字段 `feePerUnit`）
- [ ] 支持筛选参数：`maxFeeBps`、`minScore`、`q`、`available`，排序 `score_desc|fee_asc|capacity_desc|recent`

## 代码（FE）
- [ ] 新增 `/(seller)/warehouses/page.tsx`（或统一入口），渲染列表与筛选器；卡片 CTA 跳转 `/(merchant)/orders/new?warehouse=0x...`
- [ ] O1：`CreateOrderView` 在初始化读取 `?warehouse=` 预选仓库（联动 O1 changes）

## 共享类型
- [ ] 如需在 L1 展示/筛选存储费，扩展 `packages/shared/src/dto/orders.ts` 的 `WarehouseSummary`：新增可选字段 `feePerUnit?: number`

## 文档
- [ ] `docs/architecture/10-场景化端到端数据流.md:10.5` 回填 Anchors 与与 W1/O1 的联动说明

## 验收
- [ ] `/api/warehouses` 返回期望结构；支持费率/评分/关键词筛选
- [ ] Listing 卡片 CTA 能直达下单页并预选仓库
