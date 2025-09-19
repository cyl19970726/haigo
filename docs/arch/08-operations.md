# Operations

## Environment Profiles
- **Monorepo Scripts** — `package.json:7` 定义 `pnpm dev`、`pnpm lint`、`pnpm test`，统一在根目录执行。
- **Frontend** — 本地开发使用 `pnpm --filter @haigo/web dev`（见 `apps/web/package.json:5`）；生产构建依赖 `next build`（`apps/web/package.json:7`）。
- **BFF** — 热重载入口为 `node --loader ts-node/esm`（`apps/bff/package.json:9`），编译输出位于 `dist/`，脚本详见 `apps/bff/package.json:7`。
- **Move** — 使用 `pnpm --filter @haigo/move compile/test`（`package.json:14`、`package.json:15`）触发 Move CLI。

## Configuration & Secrets
- Nest 配置集中在 `apps/bff/src/common/configuration.ts:1`，统一映射环境变量（Hasura、Indexer、数据库、媒体目录等）。
- 媒体存储根目录可通过 `MEDIA_STORAGE_DIR` 重写，默认为仓库 `storage/media`（`apps/bff/src/modules/media/media.storage.ts:29`）。
- Prisma 使用 `DATABASE_URL`（`apps/bff/prisma/schema.prisma:7`）；若走 Docker PoC，需要将连接串指向 `postgres://haigo:haigo@localhost:5433/haigo`。
- 前端依赖 `NEXT_PUBLIC_BFF_URL` 与 `NEXT_PUBLIC_APTOS_NETWORK`（`apps/web/lib/api/client.ts:15`, `apps/web/lib/wallet/context.tsx:15`）。

## Dockerized PoC Stack
- `docker/compose.poc.yml:1` 启动 Postgres + Hasura，默认端口 `5433/8080`，卷映射 `.hasura` 元数据用于迁移。
- 启动流程：
  1. `docker compose -f docker/compose.poc.yml up -d`
  2. 执行 `pnpm --filter @haigo/bff prisma:migrate:deploy`（`apps/bff/package.json:13`）以初始化数据表。
  3. 运行 `pnpm dev:bff` 与 `pnpm dev:web`。确保 `HASURA_URL=http://localhost:8080`、`DATABASE_URL=postgres://haigo:haigo@localhost:5433/haigo`。

## CI / CD Expectations
- 计划中的 CI 流水线需串联：`pnpm lint` → `pnpm test` → `pnpm --filter @haigo/bff build` → `pnpm --filter @haigo/web build`（脚本参考 `package.json:11` 与 `package.json:13`）。
- 部署阶段通过 `apps/bff/package.json:8` 的 `start` 命令运行编译产物，前端走 Next.js 标准 `next start`。
- Move 模块上线前应用 `move/Move.toml:7` 中的依赖版本锁定，避免 CI 环境拉取不兼容的 Aptos Framework。

## Observability & Health
- BFF 提供 `/health` 端点返回时间戳（`apps/bff/src/modules/health/health.controller.ts:4`, `apps/bff/src/modules/health/health.service.ts:5`）。
- 事件轮询器用 `Logger` 记录游标与错误（`apps/bff/src/modules/accounts/event-listener.service.ts:81`, `apps/bff/src/modules/accounts/event-listener.service.ts:119`）。部署时应聚合到集中日志。
- 上传/哈希失败会抛出结构化错误码（`apps/bff/src/modules/media/media.service.ts:69` 与 `packages/shared/src/config/orders.ts:50`）。监控可根据错误码触发告警。

## Backup & Rotation
- 上传文件按 `recordUid/stage/category` 分层存储（`apps/bff/src/modules/media/media.storage.ts:37`），建议定期同步至外部对象存储；PoC 阶段可通过 `storage/media` 目录快照备份。
- Prisma 表结构具备唯一索引防止重复事件（`apps/bff/prisma/schema.prisma:29`, `apps/bff/prisma/schema.prisma:51`），备份前需确保数据库角色具备 `pg_dump` 权限。

## Future Hooks (Planned)
- 订单写入/回放将落地于 `apps/bff/src/modules/orders/orders.controller.ts (planned)` 与 `apps/bff/src/modules/orders/orders.event-listener.ts (planned)`，对应的迁移脚本需提前在 `apps/bff/prisma/migrations` 中预留目录。
- CI 部署脚本将在 `tooling/scripts/deploy.sh (planned)` 中收敛 docker build & Move 发布流程。
