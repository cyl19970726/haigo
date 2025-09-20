# Warehouse Dashboard — Staking Quick Actions Integration Plan

## 1. Goals & Scope
- 将 `/dashboard/warehouse` 中“快速质押”和“调整费率”入口由简单跳转改为弹出内嵌卡片（Modal/Dialog 卡片）。
- 在弹出卡片内完成输入、校验、签名与提交；成功后刷新质押概览数据。
- 对齐 docs/architecture/5-前端体验.md 的交互规范，并复用 W1 计划中既有链上 / BFF / 前端能力，不引入新的类型错误。

## 2. 体系结构概览
### 2.1 链上数据结构 & 函数（`move/sources/staking.move`）
- `struct StakingBook { positions: Table<address,u64>, fees: Table<address,u64>, stake_changed_events, fee_updated_events }`
- `struct StakeChanged { warehouse, delta, new_amount, timestamp }`
- `struct StorageFeeUpdated { warehouse, fee_per_unit, timestamp }`
- 视图：`get_stake(address) -> u64`、`get_storage_fee(address) -> u64`
- 入口函数：`stake<CoinType>(warehouse, amount)`、`unstake<CoinType>(warehouse, amount)`、`set_storage_fee(warehouse, fee_per_unit)`
- 错误码：`E_INVALID_AMOUNT`、`E_INVALID_FEE`、`E_UNAUTHORIZED_ROLE` 等，用于前端错误提示。

### 2.2 后端（BFF）数据结构 & API
- Prisma 表：
  - `staking_positions` (`warehouse_address`, `staked_amount`, `last_txn_version`, `last_event_index`)
  - `storage_fees_cache` (`warehouse_address`, `fee_per_unit`, 同步游标字段)
- DTO：`packages/shared/src/dto/staking.ts`
  - `StakingIntentDto { warehouseAddress, stakedAmount, minRequired, feePerUnit }`
- 服务与监听：
  - `StakingService.getIntent(address)`：先调用链上 view（`get_stake`, `get_storage_fee`），失败回退缓存。
  - `StakingListener`：订阅 `StakeChanged` / `StorageFeeUpdated` 事件写入缓存，维持游标。
- HTTP 接口：
  - `GET /api/staking/:warehouseAddress` → `{ data: StakingIntentDto, meta: { source: 'onchain' | 'cache' } }`
  - （无 POST/PUT；写操作通过钱包交易完成。）

### 2.3 前端数据结构 & Hooks
- `fetchStakingIntent(address)`（`apps/web/lib/api/staking.ts`）→ Promise<`StakingIntentDto`>
- `useStakingIntent(address)`（`apps/web/features/staking/hooks/useStakingIntent.ts`）→ React Query 包装。
- `useStakingActions()`（`apps/web/features/staking/useStakingActions.ts`）
  - 公开 `{ stake(amountAPT), unstake(amountAPT), setStorageFee(feeBps), submitting, error, lastHash }`
  - 内部调用钱包 `signAndSubmitTransaction`，构造 entry function payload：
    - Stake/Unstake：`function = {MODULE}::staking::stake|unstake`, `type_arguments = [APTOS_COIN_TYPE]`, `arguments = [amount_octas]`
    - Set fee：`function = {MODULE}::staking::set_storage_fee`, `type_arguments = []`, `arguments = [fee_bps]`

### 2.4 Storage Fee & Insurance 状态调研
- **链上合约现状**：`orders::create_order` 仍使用 `PricingRecord` 字段 `{ amount, insurance_fee, platform_fee, total }`，并在创建时将三者合计转入 `OrderBook.platform_account`。仓库 `set_storage_fee` 仅记录 `fee_per_unit`，未参与订单定价或结算。
- **事件结构**：`OrderCreated` 事件与上表一致，不含单独的 `storage_fee` 字段，且在 `orders.move` 中未记录应付给仓库的费用。
- **链下 / 前端**：`packages/shared/src/dto/orders.ts` 里的 `PricingBreakdown.platformFeeSubunits` 对应 UI 的“Platform fee”，默认 0.75%，与 PRD 中“存储费一次性支付”描述不符；仓库列表虽暴露 `feePerUnit`，但订单创建未引用该值。
- **保险费**：UI 允许自定义保险费率（默认 2.5%），尚未与要求的 `商品价值 ÷ 100` 对齐，链上也无强校验。
- **结论**：若要满足“商家一次性支付存储费与保险费、仓库在出库后领取存储费”的目标，需要同步更新 Move 合约、事件、DTO、BFF 及前端定价逻辑。当前计划仅覆盖质押/费率弹窗，需要新增改造方案。

## 3. 交互与状态流
1. 用户点击“快速质押” → 打开 `StakeActionCard`（对话框）。
   - 表单字段：质押金额 (APT)，可选使用预置按钮（25 / 50 / 100）。
   - 校验：>0、最多保留 4 位小数、转换为 octa。
   - 提交：调用 `useStakingActions().stake(amount)` → 等待链上交易 → 显示状态徽标。
   - 成功后触发 `useStakingIntent` 的 `refetch()`，以及 Toast（含 txn hash 链接）。
2. 用户点击“调整费率” → 打开 `FeeActionCard`。
   - 表单字段：费率 (bps)，限制 `0 <= fee <= 10000`。
   - 提交：调用 `setStorageFee(fee)`。
   - 成功同样刷新 intent。
3. 错误处理：捕获 `useStakingActions().error`，根据错误码/消息提示（例如 `E_INVALID_AMOUNT` -> “金额不足”）。
4. 加载指示：按钮 disabled，显示 loading spinner；dialog 关闭后清空。
5. 未连接钱包：Quick Actions 按钮禁用并提示“请先连接钱包”。

## 4. 实现步骤
1. **对话框基架**
   - 在 `apps/web/features/dashboard/warehouse/` 下新增 `WarehouseStakingActionDialog.tsx`，封装 Shadcn `Dialog` + 表单（可复用 `Form`, `Input`, `Label`, `Button`, `Alert`）。
   - 按类型接受 props：`mode: 'stake' | 'fee'`, `onSuccess(txHash)`, `onClose()`。
   - 内部注入 `useStakingActions`, `useWalletContext`。
2. **Quick Actions 卡片接线**
   - 将 `WarehouseQuickActionsCard` 中对应按钮由 `<Link>` 替换为 `button` 触发对话框状态（提升 state 到父组件 `WarehouseDashboardPage` 或使用 context）。
   - 对未实现入口保留“敬请期待”。
3. **表单逻辑**
   - 质押表单：
     - `amount` state (字符串) → 解析 `parseFloat` → octa via `Math.round(amount * 1e8)`。
     - 显示当前 `StakingIntentDto.stakedAmount`（APT）和 `minRequired`（如未来扩展）。
   - 费率表单：`fee` state → `Number` → clamp → 发送；默认值取 `WarehouseSummary.feePerUnit`（bps），并允许仓库在弹窗内调整后提交。
4. **API 链接与数据刷新**
   - 调用成功后 `await refetch()`（从 `useStakingIntent`）。
   - 若 `meta.source === 'cache'`，在成功 toast 中提示数据可能延迟（可选）。
5. **UI/可访问性**
   - Dialog 加 `role="dialog"`，`aria-labelledby` 绑定标题。
   - 键盘可关闭（Esc）、聚焦第一个输入。
6. **类型安全**
   - 所有金额和费率通过 `number | string` 转换前校验，避免 NaN；对 `useStakingActions` 返回类型加上显式返回值类型。

## 5. 需要的 API & 依赖清单
- 链上：
  - `haigo::staking::stake<CoinType>(amount_octas)`
  - `haigo::staking::unstake<CoinType>(amount_octas)`（如在对话框中提供解押入口，可共用 UI）
  - `haigo::staking::set_storage_fee(fee_bps)`
- BFF：
  - `GET /api/staking/:warehouse`（刷新卡片数据）
  - Staking Listener 持续同步上述事件。
- 前端：
  - `useStakingActions`（签名 & 提交）
  - `useStakingIntent` / `fetchStakingIntent`
  - Shadcn 组件：`Dialog`, `Button`, `Input`, `Label`, `Alert`, `Badge`（若缺则通过 MCP 引入）。

## 6. 验收 & 测试
- 单元/组件：构建 `WarehouseStakingActionDialog.test.tsx`，覆盖
  - 表单校验（无输入禁用提交、超限提示）。
  - 模拟签名成功/失败（mock `useStakingActions`）。
- 集成/手动：
  - 钱包连接 → 质押 1.5 APT → 交易成功 → 卡片刷新显示新额度。
  - 设置费率 35 → `StakingIntentDto.feePerUnit` 更新。
  - 断网/链上视图失败 → 确认回退至缓存仍可展示。
- 无障碍：Dialog 可键盘操作，按钮具备 `aria-label`。
- 类型检查：`pnpm --filter @haigo/web lint` + `pnpm --filter @haigo/web test`。

## 7. 风险与缓解
- **模块地址未配置** → 在对话框中检测 `NEXT_PUBLIC_APTOS_MODULE`，提示“请联系管理员配置模块地址”。
- **链上事务确认延迟** → 成功 toast 中提示“数据将在链上确认后刷新”，必要时轮询 `refetch`。
- **Indexer 缓存延迟** → 若 `meta.source === 'cache'` 且金额未更新，提供“强制刷新（链上视图）”按钮调用 `refetch()`。
- **钱包断开** → `useWalletContext.status !== 'connected'` 时禁用按钮并展示提醒。

## 8. 后续扩展（非本次范围）
- 支持“快速解押”入口复用相同卡片。
- 写入 staking 操作历史（使用 `StakeChanged` 事件列表）。
- 在 Quick Actions 卡片展示最近一次质押交易 hash。

## 9. 合约 / 数据结构 / API 调整建议（存储费 & 保险）
1. **Move 合约**
   - 将 `PricingRecord.platform_fee` / `OrderCreated.pricing.platform_fee` 改造为 `storage_fee`，并在 `create_order` 入参中显式传入或链上读取仓库 `fee_per_unit` 后计算一次性费用。
   - 在 `Order` 资源中保留 `storage_fee` 以便出库时核对；在 `check_out` 中补充结算逻辑（例如要求平台账户签名或触发事件供链下派发）。
   - 追加事件（或扩展现有事件）以记录仓库应收 `storage_fee` 额度，确保 Indexer/BFF 可感知结算状态。
2. **共享 DTO / BFF / 数据库**
   - 更新 `packages/shared/src/dto/orders.ts`、`calculatePricing` 与相关测试，将 `platformFeeSubunits` 重命名为 `storageFeeSubunits` 并调整引用。
   - 调整 Prisma schema（`orders`, `order_events`）及迁移脚本，新增 `storageFeeSubunits` 字段，与文档《detail/indexer-schema.md》保持一致。
   - 修改 `OrdersRepository` / `OrdersEventListener` 以写入新的字段，并在列表/详情响应中返回 `storageFeeSubunits`。
3. **前端订单流程**
   - 从 `WarehouseSummary.feePerUnit`（bps）推导只读存储费率，移除“Platform fee”可编辑控件，防止商家自行修改仓库收费。
   - 将保险费率默认值调整至 1%（商品价值 1/100），并在提交前校验上限；预留未来从 `insurance_config` 动态读取的能力。
   - 在订单回顾、Dashboard、目录卡片中统一使用“Storage fee”术语，避免与平台佣金混淆。
4. **索引 / 监听**
   - 确保 BFF 监听的 `OrderCreated` 事件解析包含 `storage_fee` 并写入缓存，以便仓库 Dashboard 在订单收件箱中显示正确的费用拆解。
   - 若合约新增“storage fee settled”事件，需要为 BFF 添加监听器及数据库落库逻辑。

> 以上改造为满足 FR3（一次性支付仓储费与保险费）的前置条件；Quick Actions 对话框先按本计划落地，随后在下一阶段计划（见 `intergation-plan-001.md`）统一推进费用相关改造。

## 10. 已知运行时错误 & 修复计划
1. **Hasura JWT 缺少凭证**
   - 日志：`AccountsService` 告警 “Missing 'Authorization' or 'Cookie' header in JWT authentication mode”。
   - 影响：BFF 拉取 Hasura 订单统计失败，目录/仪表盘可能缺失订单信息。
   - 处理：
     - 在 BFF 环境变量中配置 `HASURA_GRAPHQL_ADMIN_SECRET` 或对应的 JWT Bearer token。
     - 调整 `apps/bff/src/modules/directory/directory.service.ts`（或相关 Hasura 调用）在 `fetch` 请求头附加 `Authorization: Bearer <token>` 或 `x-hasura-admin-secret`。
     - 将配置写入 `.env` 并更新部署文档。
2. **StakingListener 轮询超时 (408)**
   - 日志：`Indexer responded 408: Request Timed Out`。
   - 影响：质押事件监听中断，可能导致缓存 `staking_positions`/`storage_fees_cache` 不更新。
   - 处理：
     - 调整轮询参数：增大 `STAKING_INGESTOR_INTERVAL_MS`、降低 `STAKING_INGESTOR_PAGE_SIZE` / `MAX_PAGES_PER_TICK`，在环境配置中生效。
     - 在 `StakingListener.fetchEvents` 中对 408/429 响应启用指数退避（已有 `applyBackoff` 基础，可增加最大等待和日志）。
     - 若仍超时，考虑切换到 Aptos 提供的 Async API 或分段按版本拉取，必要时为 staking 设置专用 indexer endpoint。

## 11. 后续工作安排
- 当前计划交付后，启动 `intergation-plan-001.md` 中的“Storage Fee & Insurance Alignment Plan”，完成费用链路改造与文档更新。
- 所有实现完成后，务必回写 `docs/architecture/` 相关章节（尤其是第 3/4/5/10 章）以反映新流程、数据结构与交互，保持产品文档与实现一致。

## 12. 代码改动详解（按目录分组）
- `apps/web/features/dashboard/warehouse/`
  - 新增 `WarehouseStakingActionDialog.tsx`（状态管理、表单、提交逻辑、UI 文案抽离为常量）。
  - 拆分/改写 `WarehouseQuickActionsCard.tsx`，引入 `useState` 控制弹窗，复用 `StakeActionSection` 与 `FeeActionSection` 子组件（抽出通用按钮布局便于后续扩展“快速解押”）。
  - 若 `WarehouseSummary` 组件负责聚合数据，需要增加 `useStakingIntent` 请求并向卡片传递 `intent`、`onRefetch`。
  - 辅助文件：新增 `warehouseStakingValidators.ts`（金额/费率转换、bps ↔ 百分比工具）、`warehouseStakingCopy.ts`（弹窗标题、说明文案）。
  - 测试：`__tests__/WarehouseStakingActionDialog.test.tsx`、`WarehouseQuickActionsCard.test.tsx`，覆盖 UI 行为与交互状态。
- `apps/web/lib/api/staking.ts`
  - 确认 `fetchStakingIntent` 支持强制刷新参数（例如 `?source=onchain`），若无则新增；为响应结构补充 `meta.source`，并在类型定义中显式声明。
  - 更新错误处理，映射链上错误码至 UI 友好提示。
- `apps/web/features/staking/useStakingActions.ts`
  - 扩展返回值：区分 `stakeSubmitting`, `feeSubmitting` 或 `pendingAction`，供对话框细粒度禁用。
  - 为 `setStorageFee` 追加输入校验（<= 10000），并在提交前对钱包连接状态进行断言。
- `packages/shared/src/dto/staking.ts`
  - 校对 `StakingIntentDto` 字段，必要时新增 `minRequired`、`chainTxnVersion` 等字段，前端同步更新类型。
  - 对应 `apps/web/types/staking.ts`（若存在）更新类型导出。
- `apps/bff/src/modules/staking/`
  - 在 `StakingController` 确认响应包含 `meta` 字段，并处理 `?source=onchain`。若需支持强制刷新，补充链上调用逻辑及错误处理。
  - `StakingService` 中加入日志/metrics，记录从链上读取失败时的回退原因，便于前端 toast 提示。
  - 更新 `StakingListener` 重试策略，与前端的二级刷新提示相呼应。
- `apps/bff/prisma/schema.prisma`
  - 验证是否已有 `storage_fees_cache`/`staking_positions` 表索引；若需要增加联合索引以支撑高频刷新，在迁移中补充。
- `move/sources/staking.move`
  - 若需要暴露新的视图或事件字段（例如 `min_required_stake`），在本次计划中先记录 TODO，并在 `integration-plan-001` 中排期。
- 共通工具
  - 检查 `packages/shared/src/utils/format.ts` 是否已有 APT ↔ Octa 格式化函数，若无则新增并在前端复用。
  - 在 `packages/ui`（若存在）添加通用 `FormAmountInput`，减少重复表单逻辑。

## 13. 文档更新计划（docs/architecture/）
- `3-链上合约设计.md`
  - 补充 staking 模块的对话框交互引起的额外链上视图调用频率、错误码处理策略。
  - 若后续引入存储费结算事件，预留章节描述资源结构与事件语义。
- `4-链下服务与数据流.md`
  - 更新 BFF `StakingService`、`StakingListener` 的数据流图，加入缓存回退与强制刷新流程。
  - 描述新增的 API 查询参数、重试/退避策略及与 Indexer 的交互。
- `5-前端体验.md`
  - 插入“Warehouse Dashboard Quick Actions”小节，包含弹窗流程、空状态、错误提示、loading、成功反馈示意。
  - 在可访问性章节中记录对话框键盘行为及钱包未连接状态的 UX 处理。
- `6-部署与环境.md`
  - 标记新的环境变量（例如 `NEXT_PUBLIC_STAKING_MODULE_ADDRESS`、BFF 访问链上视图所需的 RPC endpoint 配置）。
- `10-场景化端到端数据流.md`
  - 增加“仓库调整质押与费率”端到端时序图，从前端 → BFF → 链上 → Indexer → 仪表盘刷新。
- `8-演进路线.md`
  - 记录本计划后续 Stage（例如存储费/保险费改造）与 `intergation-plan-001.md` 衔接关系。
- 若新增/修改共用类型或术语，更新 `index.md` 或 `1-架构目标与范围.md` 的术语表，确保“Storage fee”、“Staking intent”等术语一致。

## 14. 代码改动执行顺序与责任分配
| 序号 | 模块/目录 | 主要内容 | 负责人（建议） | 前置依赖 | 里程碑检查 |
| ---- | ---------- | -------- | -------------- | -------- | ---------- |
| 1 | `packages/shared/src/utils/format.ts` & 共通类型 | 新增格式化/类型定义，消除前端重复逻辑 | FE 平台组（负责人：@fe-shared） | 无 | 完成后为前端提供 API |
| 2 | `apps/web/lib/api/staking.ts` & DTO | 扩展 fetch & 类型补全 | FE 仪表盘小队（负责人：@fe-warehouse） | 步骤 1 | 确认 TS 类型通过 lint |
| 3 | `packages/shared/src/dto/staking.ts` | DTO 字段同步、版本号/源标记 | 平台协议组（负责人：@shared-dto） | 步骤 1 | 同步到前端 & BFF 类型检查 |
| 4 | `apps/bff/src/modules/staking/` & Prisma | API 强制刷新、监听重试、索引优化 | BFF 服务组（负责人：@bff-staking） | 步骤 3 | `pnpm --filter @haigo/bff test` 通过 |
| 5 | `apps/web/features/staking/useStakingActions.ts` | 提交状态细分、错误码映射 | FE 仪表盘小队 | 步骤 2/3 | Storybook / jest mock 覆盖 |
| 6 | `apps/web/features/dashboard/warehouse/` UI | Dialog 组件、卡片改造、状态提升 | FE 仪表盘小队 | 步骤 2/5 | Cypress/Playwright smoke 通过 |
| 7 | `packages/ui`（如需） | 共用输入组件抽象 | FE 平台组 | 步骤 1 | 组件库单测通过 |
| 8 | `apps/bff/prisma` 迁移 | 索引/字段迁移（若确认需要） | 数据基础组（负责人：@data-infra） | 步骤 4 | 迁移脚本 dry-run 无误 |
| 9 | `move/sources/staking.move` TODO | 记录新增视图/事件需求 | Move 核心组（负责人：@chain-dev） | 步骤 6 信息输出 | PRD 对齐后排入下一阶段 |

> 负责人欄为建议，可由项目管理调整；完成每一阶段后在 PR 检查表记录验证结果。

## 15. 文档更新责任与排期建议
| 文档 | 负责人（建议） | 触发条件 | 计划完成时间 |
| ---- | -------------- | ---------- | -------------- |
| `docs/architecture/5-前端体验.md` | FE 设计联络人（@ux-frontend） | 前端 Dialog 完成立即可更新，包含截图/动效描述 | Dev 完成 +2 天 |
| `docs/architecture/3-链上合约设计.md` | Move 核心组文档代表（@chain-docs） | 如新增错误码/视图/事件 PR 合并 | 合约 PR 合并后一周内 |
| `docs/architecture/4-链下服务与数据流.md` | BFF 文档负责人（@bff-docs） | BFF 强制刷新 & 监听改造上线 | BFF PR 合并 +3 天 |
| `docs/architecture/6-部署与环境.md` | 运维/Infra（@infra-ops） | 新环境变量或 RPC 配置落地 | 配置变更审批同周内 |
| `docs/architecture/10-场景化端到端数据流.md` | 产品技术写手（@pm-techwriter） | 前端/BFF 流程可端到端演示 | 全链路验收后一周 |
| `docs/architecture/8-演进路线.md` & `index.md` 术语表 | 产品管理（@pm-owner） | Stage 1 PR 验收后，确认下一阶段依赖 | Stage 1 验收会议后一周 |

- 项目经理需要在里程碑会议上确认上述负责人；如负责人不同，请在表格中更新并发送给 PM 公布。
- 文档更新与代码合并需绑定同一 Milestone（“Warehouse Staking Quick Actions”），避免漏更。
