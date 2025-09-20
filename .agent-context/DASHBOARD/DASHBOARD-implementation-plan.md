# Dashboard（Seller / Warehouse）— 实施计划（Design → Steps → Tests）

> 参考：.agent-context/R1/R1-registration-redirect-plan.md 与 docs/front-end-spec.md。注册成功后将跳转到角色化 Dashboard；本计划定义两个仪表盘的最小可用实现（MVP），供后续 Epic 扩展。

## 1. 目标与交付物
- 两个路由：`/dashboard/seller`、`/dashboard/warehouse`（Next.js App Router）。
- 公共壳层：欢迎区块 + 快捷链接 + 数据加载态/错误态。
- Seller 仪表盘卡片：
  - 最近订单（来自 GET /api/orders?seller=…）
  - 快速下单入口（跳转到订单创建向导）
  - 通知/提示（如网络切换、配置提示）
- Warehouse 仪表盘卡片：
  - 质押与存储费（W1 的 /api/staking/intent、/api/staking/storage-fee）
  - 订单收件箱（W2 的 /api/orders?warehouse=…）
  - 快捷操作（入库/出库入口、设置费率）

## 2. Anchors（planned）
- FE：
  - apps/web/app/dashboard/seller/page.tsx
  - apps/web/app/dashboard/warehouse/page.tsx
  - apps/web/features/dashboard/SellerDashboard.tsx（容器）
  - apps/web/features/dashboard/WarehouseDashboard.tsx（容器）
  - apps/web/features/dashboard/components/*（卡片组件）
- API：
  - Seller：GET /api/orders?seller=…（已存在）
  - Warehouse：GET /api/orders?warehouse=…（W2 扩展）；GET /api/staking/intent（W1），POST /api/staking/storage-fee（W1）

## 3. 信息架构与布局
- 顶部：欢迎文本（角色识别）+ 帮助链接（FAQ/Docs）
- 网格：3–6 个卡片，按重要性排序；移动端改两列或单列。
- 组件库：shadcn Button/Card/Skeleton/Toast；保持一致样式。

## 4. 数据加载与错误
- 初始加载 Skeleton；
- 错误呈现（role=alert），提供重试；
- 网络不匹配 → 使用现有 NetworkGuard 包裹关键卡片。

## 5. 接入流程
1) 路由与容器文件 scaffold；
2) Seller 卡片：最近订单（调用 fetchOrderSummaries）+ CTA（去下单）；
3) Warehouse 卡片：质押/费率（W1 Hook）+ 订单收件箱（W2 Hook）；
4) 无数据状态与错误处理；
5) 无障碍检查（aria-*）；

## 6. 测试计划
- 单元：容器渲染、Hook 参数映射、空数据/错误；
- 集成：Mock API 返回 → 页面渲染列表与 CTA 跳转；

## 7. 验收标准
- 注册成功后，跳转至 `/dashboard/{role}` 可正确加载卡片；
- Seller 看见最近订单与去下单 CTA；
- Warehouse 看见质押/费率与订单收件箱；
- 加载/错误状态清晰，移动端可用；
