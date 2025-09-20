# M1 商家评价 — 实施计划

## 目标
- 商家对已完成订单进行评分与评价，形成仓库可见的声誉数据（暂不涉及链上 slash）。

## 步骤
1) 数据：reviews 表（planned）：record_uid、warehouse_address、rating、comment、created_at
2) BFF：`apps/bff/src/modules/reputation/*`（planned）
- POST /api/reviews；GET /api/warehouses/:addr/reviews
3) FE：`MerchantReviews` 组件与列表

## 测试
- 评价创建/查询；基础校验

## 验收
- 评价可写入并在 Listing/仓库页聚合展示
