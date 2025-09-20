# Warehouse Dashboard Revamp Plan

## Goals & Constraints
- 对齐 `docs/architecture/5-前端体验.md` 第 5 节关于仓库仪表盘的布局、组件与交互规范。
- 参考当前线上状态（见截图 `截屏2025-09-19 18.30.23.png`）识别偏差，补齐缺失的卡片、工具栏与状态处理。
- 仅使用现有或 Shadcn UI 组件库（`apps/web/components/ui/*`），若缺失组件再通过 shadcn MCP 引入。
- 所有调整保持移动优先、ARIA 声明、Skeleton/错误/空态的完整性。

## Current Gaps vs Spec
- 缺少头部工具栏：规范要求顶部右侧有 `[帮助] [文档] [Sign out]`，当前仅有 SignOutButton，且样式不统一。
- 卡片排布不符：
  - 规范首行应为“质押与费用概览”（含 CTA 区块）与“Staking / Fee 指标”，当前只有单个卡片且宽度占比不合理。
  - 应有“Orders Inbox (latest 5)” 全宽卡片，下方再有 “Ops Snapshot (占位)” 等扩展，现实现仅有两个并排卡片。
- 缺少“Quick Actions”与运营占位说明，导致用户无法快速跳转订单列表、个人资料等常用路径。
- 背景与间距：规范建议整页使用柔和背景（如 `bg-muted/40`）+ `max-w-6xl` 容器，目前主背景纯白且模块之间间距不足。
- 无帮助/文档链接 & CTA icon：缺少统一按钮样式和 aria 标签。
- 响应式：目前栅格在小屏仍保持两列，未按规范折叠为单列。
- 无额外状态提示（钱包未连接时的顶层提醒、全局 loading/错误 banner）。

## Target Layout (ASCII)
```
┌───────────────────────────────────────────────────────────────┐
│  仓库工作台                                [帮助] [文档] [Sign out] │
├───────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────┐  ┌──────────────────────────┐  │
│  │  质押与费用概览               │  │  Quick Actions          │  │
│  │  当前质押 / 最低要求 / 差值     │  │  [新建订单] [全部订单]     │  │
│  │  [Stake] [Adjust Fee] CTA │  │  [仓库资料]              │  │
│  └────────────────────────────┘  └──────────────────────────┘  │
├───────────────────────────────────────────────────────────────┤
│  Orders Inbox (latest 5)                                       │
│  列表项：状态徽章 / 订单号 / 金额 / 创建时间 / 查看详情            │
│  底部：查看全部订单 →                                          │
├───────────────────────────────────────────────────────────────┤
│  Ops Snapshot (placeholder)                                    │
│  说明文案 + 未来指标占位，支持 Skeleton / 空态文案。             │
└───────────────────────────────────────────────────────────────┘
```

## Implementation Workstream
1. **Layout Shell 重构** (`apps/web/app/dashboard/warehouse/page.tsx`)
   - 引入 `bg-muted/40` 页面背景 + `container mx-auto max-w-6xl`。
   - 顶部 `<header>` 改为 `flex justify-between items-start`, 右侧新建 `DashboardLinks`（Help/Docs/SignOut）。
   - 拆分主体为三段：`metricsGrid`（质押 + 快捷动作），`ordersSection`（全宽卡片），`opsSection`（占位卡片）。
   - 在 `lg` 断点使用两列栅格，小屏落为一列 (`grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]`)。
   - 若钱包未连接，顶部显示 `Alert` 或轻提示（复用 shadcn `Alert`）。

2. **质押与费用卡片增强** (`WarehouseStakingCard.tsx`)
   - 左右两列布局：左侧当前数值 & 状态徽章，右侧加入费率摘要，底部 CTA 组 `[Stake] [Adjust Fee]`（Buttons，variant outline/secondary）。
   - 提供 Skeleton 行、错误态 `Alert`、未连接提示（已存在，但需适配新的布局）。
   - Button 行为：现阶段链接 `href="/staking"`、`/staking/fee`（如缺则暂指向 `/staking` 并 TODO 说明）。

3. **Quick Actions 卡片（新建）**
   - 新增组件 `apps/web/features/dashboard/warehouse/WarehouseQuickActions.tsx`。
   - 使用 `Card` + `Button` 组合，按钮路径：`/orders/new`, `/(warehouse)/orders`, `/dashboard/settings`（若无路由则占位 tooltip）。
   - 按需引入 `ArrowUpRight` 图标（lucide-react），按钮 `size="sm"`，附 aria-label。

4. **Orders Inbox 卡片微调** (`WarehouseOrdersCard.tsx`)
   - 容器设置为全宽 (`className="lg:col-span-2"`)，移除外层边框重复，保留 Skeleton/错误态。
   - 列表项内添加 `Separator` 以提高密度可读性。
   - 顶部加子标题“最新 5 条订单”，提供刷新按钮（`Button` variant ghost icon-only）。

5. **Ops Snapshot 占位卡片（新建）**
   - 创建组件 `WarehouseOpsSnapshotCard.tsx` 展示说明文案 + TODO 列表。
   - 支持 Skeleton/空态 + future metrics placeholder。

6. **帮助 / 文档链接**
   - 构建 `DashboardSupportLinks` 组件，按钮使用 `Button` with `variant="ghost" size="sm"`。
   - 链接地址：`
     - 帮助 → `/docs/warehouse/onboarding`（若暂缺，用 `#` 并 TODO）。
     - 文档 → `/docs`。
   - 添加 `aria-label` 与 `target="_blank"`（如指向外部）。

7. **状态与可访问性**
   - 所有按钮添加 `aria-label`，卡片标题 `<h2>`。
   - `OrdersCard` 列表 `aria-live` 保持 polite。
   - 为页面主容器添加 `aria-labelledby` 指向 `h1`。

8. **Testing & QA**
   - 手动测试：钱包未连接、加载失败、无订单、有订单。
   - 使用 `pnpm lint`、`pnpm test --filter Warehouse`（若存在）。
   - 生成截图或 Storybook 审核（如项目中已启用）。

## Shadcn Components Inventory
- 已有：`Button`, `Card`, `Badge`, `Alert`, `Skeleton`, `Separator`, `Pagination` (orders 列表)、`Table`。
- 可能新增：`Tooltip`, `Button` icon variant（参考 `apps/web/components/ui/button.tsx`）。如需引入 `Separator`/`Tooltip`，通过 MCP 命令 `npx shadcn@latest add separator tooltip`。

## Deliverables
- 更新后的 `WarehouseDashboardPage` 布局与四个卡片组件。
- 新增 QuickActions 与 OpsSnapshot 组件及对应测试/故事（如适用）。
- 文档或 README 更新：说明帮助/文档链接与未来指标 TODO。

## Timeline & Ownership
1. 架构确认与 UI 设计同步（0.5d）。
2. 组件开发与联调（1.5d）。
3. 状态测试与无障碍梳理（0.5d）。
4. 验收+截屏回传（0.5d）。

风险：后端暂未提供 Quick Actions 目标路由（如仓库资料页），需在实现时确认链接；质押相关接口若延迟，需要降级文案提示。
