# W1 家庭仓质押与存储费设置 — 实现评审（Review）

> 目标：对照《W1-implementation-plan.md》审查当前实现（Move/BFF/FE/Shared），给出结论、差距与建议的修复清单与验收要点。

## 结论 TL;DR
- 范围覆盖良好：Move 合约、BFF（Controller/Service/Listener/Repository/Prisma）、FE（Dashboard/Hook/Actions）、Shared DTO 均已落地，基本满足 PoC 场景。
- 可上线 PoC 前置条件：执行 Prisma 迁移与 Shared 构建，配置 `NEXT_PUBLIC_APTOS_MODULE`，并验证 Indexer/Fullnode 可用性。
- 最新进展：BFF Service 已实现“链上视图优先，失败回落缓存”。
- 主要差距：
  - Listener 之前未做 Fullnode 兜底补全 txn hash/timestamp（已补：按 Accounts 方式调用 by_version，当前仅用于日志与调试，不入库）。
  - Move 事件 delta 在 unstake 分支为正（Move 不支持有符号整型），已明确 BFF/FE 仅使用 new_amount，不消费 delta。
 - 已确认非目标：历史曲线 API 暂不需要。

## 范围与基线
- 实施计划：`.agent-context/W1/W1-implementation-plan.md`
- 目标交付：FE Staking 面板 + BFF 监听与缓存 + Move 事件/视图 + Shared DTO

## 实现对照（逐项核对）

- Move 合约与视图
  - 文件：`move/sources/staking.move:1`
  - 已实现：`stake<CoinType>`, `unstake<CoinType>`, `set_storage_fee`, 事件 `StakeChanged`, `StorageFeeUpdated`，视图 `get_stake`, `get_storage_fee`，以及测试用例 `test_stake_and_fee_flow`、`test_unstake_invalid_amount`。
  - 备注：PoC 仅做记账，不锁定 Coin；权限通过 `registry::assert_role` 限制为仓库角色；`fee_per_unit` 上限 10000。
  - 注意：`unstake` 事件中 `delta` 当前为正数（注释标注“客户端理解为负”），建议将 `delta` 置为负值，或在 BFF/FE 明确不使用 `delta`。

- BFF 模块
  - 挂载：`apps/bff/src/modules/app.module.ts:10` 引入 `StakingModule`。
  - 控制器：`apps/bff/src/modules/staking/staking.controller.ts:1` 暴露 `GET /api/staking/:warehouseAddress`，返回 `{ data, meta.source }`。
  - 服务：`apps/bff/src/modules/staking/staking.service.ts:47` 通过 Fullnode `POST /v1/view` 调用 `${module}::staking::{get_stake,get_storage_fee}`，成功时返回 `meta.source='onchain'`；失败则回落仓库缓存返回 `meta.source='cache'`。视图调用封装于 `callView`（`apps/bff/src/modules/staking/staking.service.ts:21-45`），自动附加 `x-aptos-api-key/authorization` 头。
  - 仓储：`apps/bff/src/modules/staking/staking.repository.ts:1` 提供 `upsertStake/upsertFee/readIntent/getLatestCursor`，游标取两表 max(version/index)。
  - 监听：`apps/bff/src/modules/staking/staking.listener.ts:1` 基于 Indexer GraphQL 轮询，支持分页/退避/冷却，事件类型由 `NEXT_PUBLIC_APTOS_MODULE` 拼接；写入缓存并更新 metrics。
  - 指标：`apps/bff/src/modules/metrics/metrics.service.ts:1` 与 `apps/bff/src/modules/metrics/metrics.controller.ts:1` 已包含 `staking_listener_*` 指标并通过 `/metrics` 暴露。

- 数据模型（Prisma）
  - 文件：`apps/bff/prisma/schema.prisma:104` 新增 `staking_positions` 与 `storage_fees_cache`，含游标索引。
  - 检查点：需执行 migrate 以落表（见建议清单）。

- FE 前端
  - 路由：`apps/web/app/(warehouse)/staking/page.tsx:1` 指向 Dashboard。
  - 面板：`apps/web/features/staking/StakingDashboard.tsx:1` 展示 `stakedAmount/feePerUnit`，含 `Stake/Unstake/Set Storage Fee` 按钮与可达性提示。
  - Hook：`apps/web/features/staking/hooks/useStakingIntent.ts:1` 使用 React Query 拉取 BFF。
  - API：`apps/web/lib/api/staking.ts:1` 容错 404 返回空意图，支持直返或 Envelope。
  - 钱包操作：`apps/web/features/staking/useStakingActions.ts:1` 基于 `NEXT_PUBLIC_APTOS_MODULE` 组装 `staking::stake/unstake/set_storage_fee`，签名并回显 txn hash。

- Shared DTO
  - DTO：`packages/shared/src/dto/staking.ts:1` 定义 `StakeChangedEventDto/StorageFeeUpdatedEventDto/StakingIntentDto`。
  - Aptos 配置：`packages/shared/src/config/aptos.ts:1` 暴露 `APTOS_MODULE_ADDRESS` 等常量，BFF/FE 均有引用。

## 发现的问题与建议

1) BFF Service 已实现链上视图优先
- 现状：已通过 `/v1/view` 实现，自动带 API Key 头，成功返回 `meta.source='onchain'`。
- 建议：可选增强项：
  - 对视图返回的数值统一做 `String()`/`Number()` 安全转换并加入边界检查；
  - 增加轻量重试/短路策略以避免瞬时 5xx 导致立即回落；
  - 可选：在成功读到视图时异步校准缓存（保持与 on-chain 一致）。

2) Listener 缺少 Fullnode 兜底
- 现状：已在 `staking.listener.ts` 引入 `resolveTxnMetaByVersion`，并为 GraphQL 请求与 Fullnode 请求均附带 API Key 头；当前不入库，仅用于调试与未来扩展。
- 建议：如需要在列表页显示事务哈希/时间，后续可扩展缓存表或单独的事件镜像表（非本迭代目标）。

3) 历史曲线 API（已明确非目标）
// 本迭代不实现，如后续纳入范围再补规划与数据模型。

4) Move 事件 delta 语义
- 现状：`unstake` 事件 `delta` 输出正数；Move 无有符号整型。
- 决策：明确 BFF/FE 忽略 `delta`，仅使用 `new_amount`。如需方向性，使用相邻事件差分或增加一个布尔/枚举字段于后续版本。

5) 构建顺序与运行依赖
- 需先构建 Shared：`pnpm --filter @haigo/shared build`。
- BFF 编译/运行前需执行 Prisma 生成与迁移，保证缓存表存在。
- 环境变量：确认 `.env.local` 中 `NEXT_PUBLIC_APTOS_MODULE` 与部署地址一致，`APTOS_INDEXER_URL/APTOS_NODE_API_URL` 可用。

## 建议的修复清单（优先级从高到中）
- [x] 实现 `staking.service` 的“链上视图优先”逻辑（已完成：`apps/bff/src/modules/staking/staking.service.ts:21-71`）。
- [x] 在 `staking.listener` 中加入 Fullnode 兜底补全（请求 `/transactions/by_version/:version`），并在异常路径计数 `staking_listener_error_total{stage='process'}`（已接入兜底，计数沿用通用 error 计数）。
- [x] Move：明确不使用 `delta` 字段，仅消费 `new_amount`（代码无需变更，已在 BFF/FE 实现上遵循）。
- [ ] 文档更新：对齐 `docs/architecture/3/4/10` 与 front-end spec，去除 DTO 的 planned 标记。

## 快速验收清单（本地）
- Shared 构建：`pnpm --filter @haigo/shared build`
- Prisma：
  - `export DATABASE_URL=postgres://haigo:haigo@localhost:5433/haigo`（按本地端口修改）
  - `pnpm --filter @haigo/bff prisma generate`
  - `pnpm --filter @haigo/bff prisma migrate dev -n add_staking_tables`
- 运行：
  - `pnpm --filter @haigo/bff build && pnpm --filter @haigo/bff start`
  - `pnpm --filter @haigo/web dev`
- 验证：
  - 打开 `/api/staking/0x<warehouse>` 返回意图；当 Fullnode `/v1/view` 可用时 `meta.source=onchain`，若视图失败则回落为 `cache`。
  - FE 面板可读取并显示 `stakedAmount/feePerUnit`；按钮可发起交易（需模块地址与钱包配置）。
  - `/metrics` 可见 `staking_listener_last_version` 与 `staking_listener_error_total`。

## 需确认事项
- 事件类型拼接是否与实际部署一致：`NEXT_PUBLIC_APTOS_MODULE::staking::{StakeChanged|StorageFeeUpdated}`。
- 是否需要在缓存表中保存 txn hash/timestamp（若前端/Listing 需要展示链上时间）。
// 历史曲线已确认本迭代非目标，无需确认其范围。

以上评审如需我直接补齐 Fullnode 兜底逻辑，我可以继续提交一个小改动 PR（不触动既有接口形态）。
