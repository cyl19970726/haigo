# Debug-002 – Indexer fetch failed in AccountsEventListener

现象
- 日志：`Failed to poll registration events TypeError: fetch failed`
- 触发点：`AccountsEventListener.fetchRegistrationEvents`
- 影响：本轮无数据，可能重复快速重试，产生噪音日志

分析
- undici 的 `TypeError: fetch failed` 多为网络层瞬态问题（连接复用、DNS、对端限流/超时），不一定包含 408/429 文本。
- 之前退避逻辑仅匹配 408/429/timeout 文案，`fetch failed` 未被识别为可退避错误。

修复
- 扩展退避匹配：将 `(fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network)` 视作 30s 冷却。
- 文件：
  - `apps/bff/src/modules/accounts/event-listener.service.ts:deriveBackoff`
  - `apps/bff/src/modules/orders/orders-event-listener.service.ts:deriveBackoff`
- 已构建：`pnpm --filter @haigo/bff build`

验收
- 复现网络瞬断时，BFF 应打印应用冷却日志并在冷却后继续轮询；日志不再刷屏。

建议
- 可在`.env.local`临时提高间隔（如 60000）以进一步降低压力。
- 需要时在日志中输出当前 indexer URL 与 key 检测状态（已在启动日志提供）。

时间线
- 2025-09-19：问题记录与修复；加入退避匹配；等待现场观察。

