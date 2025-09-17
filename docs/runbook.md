# HaiGo 开发与部署 Runbook（PoC）

本指南描述开发者从本地环境到测试网部署的完整流程，确保 Move 合约、BFF、前端与官方 Aptos Indexer 协同工作。后续若引入生产环境或对象存储，可在此基础上扩展。

## 1. 前置条件
- Node.js ≥ 20、npm ≥ 10。
- Rust 工具链（Move 构建和单测）。
- Docker Desktop 或兼容容器引擎（用于 Postgres、Hasura、本地 BFF）。
- Aptos CLI ≥ 3.0，已配置测试网账户。
- `blake3` CLI 可选，用于核对哈希。

## 2. 仓库初始化
```bash
git clone <repo-url>
cd haigo
npm install
docker compose up -d postgres hasura bff
```

### 2.1 npm Workspaces
- `move/`：执行 `aptos move compile/test`。
- `apps/web`：前端。运行 `npm run dev --workspace apps/web`。
- `apps/bff`：后端。`npm run start:dev --workspace apps/bff`（生产使用 `npm run start:prod`）。
- `packages/shared`：共享类型与配置，任何改动需同步跑 `npm run build --workspace packages/shared`。

## 3. 环境变量
创建 `.env`（根目录）和各子项目 `.env.local`，关键键值如下：

| 变量 | 说明 | 示例 |
|------|------|------|
| `APTOS_NETWORK` | 目标网络 | `testnet` |
| `APTOS_ACCOUNT_ADDRESS` | 部署资源账户地址 | `0xabc...` |
| `APTOS_PRIVATE_KEY` | 部署者私钥（建议使用 keyfile 或 KMS） | `0x...` |
| `BFF_PORT` | BFF 服务端口 | `4000` |
| `HASURA_GRAPHQL_ENDPOINT` | Hasura GraphQL URL | `http://localhost:8080/v1/graphql` |
| `HASURA_ADMIN_SECRET` | Hasura 管理口令 | `changeme` |
| `APTOS_INDEXER_ENDPOINT` | 官方 Indexer GraphQL URL | `https://api.testnet.aptoslabs.com/v1/graphql` |
| `MEDIA_ROOT` | 本地媒体存储目录 | `./storage/media` |
| `MEDIA_MAX_FILE_MB` | 上传限制 | `200` |

> 提示：部署环境应改用 Secrets 管理（阿里云 KMS、GitHub Secrets 等），避免明文存储私钥。

## 4. Move 合约流程
1. **安装 Aptos CLI（macOS Apple Silicon 首选）**
   ```bash
   brew install aptos
   aptos --version
   ```
   确认版本信息无误后再继续后续步骤。MVP 范围仅验证了 macOS 14.x（Apple Silicon M4），请在同等环境下执行。
2. 配置 `move/Aptos.toml` 中的 `named_addresses`。
3. 本地编译与测试：
   ```bash
   cd move
   aptos move test
   aptos move publish --profile testnet
   ```
4. 部署后记录模块地址，更新 `packages/shared/config/aptos.ts`。
5. 使用 `aptos account list` 或官方 Indexer 查询事件，确保部署成功。

> Legacy/CI 备用：如需在非 macOS 或 CI 环境运行，可继续使用 Docker 封装的 Aptos CLI 镜像；本地开发阶段默认采用 Homebrew 方案。

## 5. BFF & 官方 Indexer 集成
1. `apps/bff` 中配置 GraphQL 客户端指向官方 Indexer。
2. 运行单元测试：`npm run test --workspace apps/bff`。
3. 启动本地：`npm run start:dev --workspace apps/bff`。
4. 核对接口：
   - `/api/accounts/:address`
   - `/api/orders/:record_uid`
   - `/api/media/uploads`

## 6. Hasura 设置
1. 通过 Docker Compose 启动 Hasura (`localhost:8080`)。
2. `hasura metadata apply` 导入项目元数据（后续将在仓库提供 `metadata/` 目录）。
3. 配置 Query Collections：储存常用 Aptos Indexer 查询。
4. 针对 `anonymous` 与 `operations` 角色设置列权限。

## 7. 前端运行
1. 更新 `apps/web/.env.local`：
   ```env
   NEXT_PUBLIC_BFF_URL=http://localhost:4000
   NEXT_PUBLIC_APTOS_NETWORK=testnet
   ```
2. 启动：`npm run dev --workspace apps/web`。
3. 验证流程：
   - 钱包连接 → 注册（调用合约）
   - 创建订单 → 检查 BFF 时间线
   - 上传媒体 → 哈希校验提示

## 8. 测试策略
- Move：`aptos move test`（覆盖注册、订单、状态机异常）。
- 后端：`npm run test --workspace apps/bff` + 集成测试（Mock Indexer 响应）。
- 前端：`npm run lint/test --workspace apps/web`（未来加入 Playwright E2E）。
- 手动验证：对照 PRD FR1–FR10 执行验收脚本。

## 9. 部署到测试网
1. 合约：`aptos move publish --profile testnet`。记录版本、事件哈希。
2. BFF/Hasura：
   - 打包镜像：`docker build -t haigo-bff ./apps/bff`。
   - 推送至容器仓库并在阿里云 ECS 上拉取运行。
   - Hasura 使用同样方式部署或采用 Docker Compose。
3. 前端：在 Vercel/阿里云静态网站托管，环境变量指向测试网。
4. 媒体目录：挂载云盘，执行每日 `rsync` 到备份位置（`cron`）。

## 10. 备份与回滚
- 媒体：
  - 每日 `tar` + `rsync` 至备份目录或 OSS。
  - 记录校验哈希，失败时告警。
- 数据库：
  - Postgres 使用 `pg_dump`，至少每日一次。
  - 回滚流程：停止 BFF → 恢复数据库 → 恢复媒体 → 重启服务。
- 合约：
  - 如需热修复，使用新模块地址并更新前端/BFF 配置；保留旧模块供审计。

## 11. 监控与告警（PoC）
- 最低要求：
  - BFF/Hasura `health` 检查（GitHub Actions cron）。
  - 媒体备份成功率日志。
  - Aptos Indexer 查询失败率（重试 + 报告）。
- 正式阶段：接入 Prometheus/Grafana、Sentry、Log Service。

## 12. 责任划分
- Move 团队：合约实现、部署、事件验证。
- BFF 团队：API 聚合、媒体处理、Hasura 权限。
- 前端团队：钱包体验、订单 UI、国际化。
- Ops：备份策略、监控、云资源管理。

## 13. 待补充
- Hasura metadata 版本库位置。
- OSS 迁移步骤（待定）。
- 测试脚本自动化与 E2E 方案。
