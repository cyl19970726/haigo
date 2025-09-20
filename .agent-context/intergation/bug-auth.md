# Bug-auth：Hasura 鉴权缺失导致账户统计与仓库目录读取失败

- 发现时间：2025-09-19
- 模块：apps/bff（AccountsService / Directory HasuraClient）
- 严重级别：高（登录流程后端补充信息缺失、目录缓存为空，直接影响前端体验）

## 现象与日志

BFF 运行期间持续输出：

```
[Nest] ... WARN [AccountsService] Hasura order count fetch failed: Missing 'Authorization' or 'Cookie' header in JWT authentication mode
[Nest] ... WARN [HasuraClient] Failed to fetch warehouse profiles from Hasura: Missing 'Authorization' or 'Cookie' header in JWT authentication mode
```

伴随目录刷新日志：

```
DEBUG [DirectoryRepository] Directory cache refresh ... total=0
```

说明所有针对 Hasura 的 GraphQL 请求均被 401 拒绝，回退结果为空。

## 根因分析

1. **Hasura 默认启用 JWT/Admin Secret 校验**：`docker/compose.poc.yml` 设置 `HASURA_GRAPHQL_ADMIN_SECRET=haigo-secret`，所有请求必须携带 `x-hasura-admin-secret` 或有效 JWT。
2. **AccountsService.fetchOrderCount 未携带鉴权**：之前的实现只发送 `x-hasura-role: anonymous`，因此被 Hasura 拒绝。
3. **目录 HasuraClient 虽支持 admin secret，但缺少调试手段**：当未配置 `HASURA_ADMIN_SECRET` 时 fallback 到 anonymous，同样产生 401，且无法方便地观察请求/响应。

## 已采取的修复 & 验证手段

| 范畴 | 说明 |
|------|------|
| 配置 | `apps/bff/src/common/configuration.ts` 新增 `debug.logDir`；`.env.local`/`.env.example` 添加 `HASURA_ADMIN_SECRET=haigo-secret` 与 `BFF_DEBUG_LOG_DIR=./storage/logs/bff`，确保本地默认携带 Admin Secret 并指定调试目录。 |
| 代码 | 1) `AccountsService` 通过 `buildHasuraHeaders()` 自动附带 `x-hasura-admin-secret`，并在 `fetchOrderCount` 前后写入调试日志。<br>2) `HasuraClient` 重构请求流程，复用同样的调试写入。<br>3) 新增 `appendDebugLog`/`sanitizeHeaders` 工具（`apps/bff/src/common/debug-log.util.ts`）按日期追加 JSON 行日志，自动遮蔽秘钥。 |
| 调试能力 | 当设置 `BFF_DEBUG_LOG_DIR` 时，所有 Hasura 请求/响应/异常将写入 `storage/logs/bff/<category>-YYYY-MM-DD.log`，便于复盘 GraphQL payload 与返回体。 |

## 复现步骤（问题版本）

1. 未设置 `HASURA_ADMIN_SECRET` 启动 BFF：`pnpm --filter @haigo/bff start:dev`。
2. 登录请求触发 `AccountsService.fetchOrderCount` 或访问仓库目录触发 `HasuraClient.fetchWarehouseProfiles`。
3. BFF 日志即出现 Missing 'Authorization' 警告。

## 修复验证步骤

1. 确认 `.env.local`（或运行环境变量）包含：
   ```
   HASURA_ADMIN_SECRET=haigo-secret
   BFF_DEBUG_LOG_DIR=./storage/logs/bff
   ```
2. 清理旧日志目录（可选）：`rm -rf storage/logs/bff`。
3. 重新启动 BFF：`pnpm --filter @haigo/bff start:dev`。
4. 执行一次登录或访问目录：
   - BFF 日志不应再出现 401 警告。
   - `storage/logs/bff/accounts-order-count-<date>.log` / `directory-warehouse-profiles-<date>.log` 中可看到 request/response 记录（Headers 中 Admin Secret 已被 `[redacted]`）。
5. 前端刷新后应能看到订单数量与仓库目录数据。

## 后续优化建议

1. **自动化检测**：为 Hasura 交互补充集成测试（可使用 MSW/Playwright stub）验证携带 Admin Secret。
2. **告警治理**：在 BFF 启动时若开启 Hasura Admin Secret 而未配置对应变量，提前抛出警告，避免运行期频繁 401。
3. **日志轮转**：长期看可引入 `pino` + 结构化传输，当前追加 JSON 行适合临时诊断，但需定期清理。
4. **权限细化**：若未来启用 JWT 模式，可在这里扩展为动态生成 `Authorization: Bearer <token>`，并复用同一调试通道。

## 当前状态

- 修复已落实到代码仓库（待部署）。
- 本地验证通过后需在 CI/CD 或部署脚本中确保环境变量同步更新。
- 团队成员可通过设置 `--env BFF_DEBUG_LOG_DIR` 快速定位后续 Hasura 相关问题。

