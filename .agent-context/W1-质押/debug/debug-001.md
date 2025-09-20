# Debug-001 — BFF 启动报错：staking_positions 表不存在

- 日期：2025-09-19
- 组件：W1 Staking（BFF 监听/仓储）
- 级别：P2（阻断 BFF 启动，但可通过迁移或容错修复）

## 现象
启动 BFF 报错退出：

```
Invalid `prisma.stakingPosition.findFirst()` invocation:

The table `public.staking_positions` does not exist in the current database.
```

堆栈关键位置：
- apps/bff/src/modules/staking/staking.repository.ts:getLatestCursor()
- apps/bff/src/modules/staking/staking.listener.ts:onModuleInit()

## 根因
W1 为 Staking 模块新增了两张缓存表（Prisma schema 定义存在）：
- `staking_positions`
- `storage_fees_cache`

但当前数据库尚未执行对应迁移，导致 Prisma 访问表时报错。

## 影响面
- BFF 启动阶段读取游标时即失败，进程退出；
- 即使跳过该处，后续 Listener upsert 也会在写入缓存表时失败。

## 复现步骤
1) 本地数据库无上述两张表；
2) 运行 `pnpm --filter @haigo/bff start`；
3) 观察到 Prisma 报错并退出。

## 修复方案
A. 标准修复（推荐）
- 执行数据库迁移以创建所需表：
  ```bash
  export DATABASE_URL="postgres://haigo:haigo@localhost:5433/haigo"
  pnpm --filter @haigo/bff exec prisma migrate dev --schema prisma/schema.prisma -n add_staking_tables
  pnpm --filter @haigo/bff prisma:generate
  pnpm --filter @haigo/bff prisma:migrate:deploy   # CI/生产
  ```

B. 代码容错（已落实）
- 在 `StakingRepository` 的 `getLatestCursor`、`upsertStake`、`upsertFee` 中增加对 Prisma 错误 code `P2021`（表不存在）的捕获：
  - 读取游标：直接返回 `null`，Listener 将从 latest 或默认起点继续；
  - 写入/upsert：记录 warn 并跳过本次持久化，避免应用崩溃；
- 目的：在迁移尚未执行时不阻断 BFF 其他功能；迁移完成后恢复正常。

## 回归与验收
- 迁移执行后，重启 BFF：不再报错，Staking Listener 正常运行；
- 未迁移情况下：BFF 可启动，日志打印警告提示“staking tables missing”；
- `/metrics` 中的 staking 指标仍可渲染（游标初始为 -1/-1 或 latest）。

## 备注
- 长期建议：
  - 在 `apps/bff/src/modules/app.module.ts` 为 StakingModule 增加特性开关（例如 `ENABLE_STAKING_MODULE=false` 可禁用）；
  - 将迁移步骤明确到部署脚本中，防止环境未迁移即启动。

