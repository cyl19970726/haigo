# R1 POC 实施变更摘要

已按“Minimal Fullnode Fallback Plan (POC)”实现：

## 代码改动
- apps/bff/src/common/configuration.ts:6-8
  - 新增 `nodeApiUrl`（`APTOS_NODE_API_URL`）配置项，默认 `https://fullnode.testnet.aptoslabs.com/v1`。
- apps/bff/src/modules/accounts/event-listener.service.ts
  - 13-41: GraphQL 查询移除 `transaction_hash`/`transaction_timestamp` 字段，避免 Indexer schema 报错。
  - 53, 59: 新增 `nodeApiUrl` 依赖注入。
  - 123-142: 新增 `resolveTxnMetaByVersion`，调用 Fullnode by_version 兜底哈希与时间戳。
  - 195-228: 在 `processEvent` 中接入兜底逻辑；失败降级使用 `unknown:{version}` 与 `new Date()`。
  - 246-256: `mapEventToAccount` 不再依赖 Indexer 返回哈希/时间戳，交由兜底填充。

## 文档注记
- docs/architecture/4-链下服务与数据流.md: 新增 4.3.4 “POC 临时兜底（Fullnode by_version）” 说明与 Anchor。

## 构建验证
- 执行 `pnpm --filter @haigo/bff build` 通过（无 TS 报错）。

## 后续手工验证建议
1) 设置环境变量：`APTOS_NODE_API_URL` 指向可用 Fullnode。
2) 启动 BFF，观察启动日志无 `transaction_hash` 字段错误；
3) 触发/回放注册事件，确认 `accounts.txn_hash` 与 `chain_timestamp` 均写入；
4) 当 Fullnode 短暂 404/429 时，日志出现 warn 且服务未中断。

