# L1 家庭仓 Listing 选择 — 实施计划

## 目标
- 商家可在 Listing 页面查询与筛选可选家庭仓（质押容量、费率、评分、媒体样本）。

## 步骤
1) BFF Directory 模块（planned）：`apps/bff/src/modules/directory/*`
- Controller: GET /api/warehouses?available=1&sort=fee
- Service: 聚合 Hasura + Postgres 附加字段
2) FE：`WarehouseListing` 页面与筛选器；复用 fetchWarehouses。

## 测试
- 列表接口分页/筛选/排序
- 前端渲染与交互

## 验收
- /api/warehouses 返回含费率/容量等；前端可筛选选择仓
