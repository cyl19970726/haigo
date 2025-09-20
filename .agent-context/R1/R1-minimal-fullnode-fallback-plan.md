# R1 Minimal Fullnode Fallback Plan (POC)

背景与动机
- 现状：仅依赖 Indexer GraphQL 时，请求包含 `transaction_hash` 导致报错：`field 'transaction_hash' not found in type: 'events'`（参考运行日志）。
- 目标：在不引入新模块/表的前提下，于 AccountsEventListener 内联调用 Fullnode REST by_version 兜底，补齐 `txnHash` 与 `chainTimestamp`，确保注册事件可靠落库。

范围与成果
- 仅改造 `AccountsEventListener` 与配置；数据库 Schema 不改，保留 `txnHash` 非空约束，尽量保证 Fullnode 请求成功。
- 文档仅标注“POC 临时兜底”，后续如扩展订单/理赔监听，再抽象为 `FullnodeSyncService`。

实现步骤（按锚点）
1) 配置扩展（新增 Fullnode Base URL）
- 文件：apps/bff/src/common/configuration.ts
- 变更：新增 `nodeApiUrl: process.env.APTOS_NODE_API_URL || 'https://fullnode.testnet.aptoslabs.com/v1'`
- 说明：与现有 `indexerUrl` 并存，便于本地/测试网切换。

2) 修正 Indexer 查询（去除不存在字段）
- 文件：apps/bff/src/modules/accounts/event-listener.service.ts
- 锚点：`REGISTRATION_EVENTS_QUERY`（约 15 行起）
- 变更：从 GraphQL 查询中移除 `transaction_hash` 与（若不存在）`transaction_timestamp` 字段，仅保留：
  - `transaction_version`, `event_index`, `type`, `data`, `account_address`
- 理由：部分 Indexer Schema 不暴露 `transaction_hash`/`transaction_timestamp`，需以 Fullnode 兜底。

3) 内联 Fullnode 兜底逻辑
- 文件：apps/bff/src/modules/accounts/event-listener.service.ts
- 锚点：`processEvent`（约 176 行起）与 `mapEventToAccount`
- 新增方法：
  ```ts
  private async resolveTxnMetaByVersion(version: string): Promise<{ hash: string; timestamp: Date } | null> {
    const base = (this.configService.get<string>('nodeApiUrl') || '').replace(/\/$/, '');
    const resp = await fetch(`${base}/transactions/by_version/${version}`);
    if (!resp.ok) return null;
    const json = await resp.json();
    const hash = typeof json?.hash === 'string' ? json.hash : '';
    // aptos REST timestamp 为微秒字符串
    const tsUs = Number(json?.timestamp || 0);
    const timestamp = new Date(Math.floor(tsUs / 1000));
    if (!hash) return null;
    return { hash, timestamp };
  }
  ```
- 在 `processEvent` 中：
  - 先按原逻辑提取 `version = event.transaction_version`；
  - 调用 `resolveTxnMetaByVersion(version)` 获取 `{hash,timestamp}`；
  - 将结果写入 `AccountUpsertInput.txnHash` 与 `chainTimestamp`；若 Fullnode 失败：
    - 记录 warn，`txnHash` 回退为 `unknown:${version}`（仅作为 POC 降级，避免写库失败）；
    - `chainTimestamp` 使用 `new Date()` 作为近似值；
- 备注：保持游标推进逻辑不变。

4) 错误处理与日志
- 不新增补偿表与定时任务；Fullnode 请求失败仅 warn 日志并继续处理后续事件。
- 日志需包含 `version:index` 方便追查。

5) 环境变量与运行
- 新增 `.env.local` 示例：`APTOS_NODE_API_URL=https://fullnode.testnet.aptoslabs.com/v1`
- 本地运行：`pnpm --filter @haigo/bff start`

6) 文档与 Anchor 更新（轻量）
- docs/architecture/4-链下服务与数据流.md：
  - 在 R1 章节补充：“POC 临时兜底：Fullnode REST 由 AccountsEventListener 直接调用”（锚点：`apps/bff/src/modules/accounts/event-listener.service.ts`）。
  - 保留 `FullnodeSyncService` 为后续增强项（TODO）。
- docs/architecture/10-场景化端到端数据流.md：
  - 在 10.2 补充 Fullnode 兜底说明（按行内注释或附注）。

7) 测试验证（POC 级）
- 单元（可选精简）：mock fetch 验证 `resolveTxnMetaByVersion` 正常/失败分支。
- 手工验证：
  1. 启动 BFF；
  2. 触发或回放注册事件；
  3. 检查数据库 `accounts` 表是否写入 `txn_hash` 且非空；
  4. 日志确认当 Indexer 缺失对应字段时未崩溃。

与问题复现/确认
- Indexer GraphQL Schema 差异确认：
  - 方案 A（推荐）：使用 Aptos MCP（aptos-mcp）查询或获取最新 Indexer 资源，确认 `events` 类型可用字段。
  - 方案 B：直接对当前配置的 Indexer 执行 GraphQL introspection（或最小查询）验证 `transaction_hash` 字段的存在性；
  - 方案 C：运行现有 BFF，观察启动日志中同样错误是否出现。
- Fullnode by_version 返回结构确认：
  - 方案 A：Aptos MCP 辅助；
  - 方案 B：`curl "$APTOS_NODE_API_URL/transactions/by_version/123"` 查看 `hash` 与 `timestamp` 字段（注意 `timestamp` 为微秒字符串）。

非目标（明确不做）
- 不实现独立 `FullnodeSyncService`、不新增补偿表/重试任务、不开监控指标（Prometheus）。
- 不修改 Prisma Schema（保持 `txnHash` 非空）。

回滚策略
- 本改动集中在 Listener 与配置文件，若故障直接回退本次改动 PR；必要时恢复原 GraphQL 查询（不包含不支持的字段）。

里程碑与责任
- 开发：1 人日；
- 复核（PM/QA）：0.5 人日；
- 文档更新：0.5 人日；

附：引用报错日志
```
[Nest] ... ERROR [AccountsEventListener] Failed to poll registration events
Error: Indexer GraphQL errors: field 'transaction_hash' not found in type: 'events'
```
