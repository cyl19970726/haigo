# Haigo Monorepo

Foundational workspace for the Haigo platform. The repository groups Move contracts, backend services, frontend client, and shared packages behind a single package manager.

## Repository Layout
```
haigo/
├─ apps/                # Runtime applications (Next.js frontend, NestJS BFF)
├─ move/                # Aptos Move package
├─ packages/            # Shared npm workspaces
├─ docs/                # Product, architecture, QA, runbook documents
├─ hasura/              # Hasura metadata and database configs
├─ scripts/             # Automation scripts (bootstrap, migrations, etc.)
├─ tooling/             # CI/CD, linting and infra helper templates
├─ .bmad-core/          # BMAD agent workflows, tasks and templates
├─ .codex/, .claude/    # AI assistant configurations and command bundles
├─ package.json         # Root workspace manifest
├─ pnpm-workspace.yaml  # Workspace definition
└─ tsconfig.base.json   # Shared TypeScript compiler options
```

- `apps/`
  - `web/`：Next.js 前端应用，核心目录包含 `app/`（App Router 页面与布局）、`components/`（UI 与交互组件）、`features/`（领域功能模块）、`lib/`（钱包、i18n、API 客户端等端侧工具）以及 `public/` 静态资源。
  - `bff/`：NestJS BFF 服务，`src/` 细分 `modules/`（订单、质押、理赔等领域逻辑）、`infrastructure/`（Hasura/Indexer/存储访问层）、`common/`（拦截器、中间件、DTO），并配套 `prisma/`、`test/` 等目录。
- `move/`：Aptos Move 模块与脚本，`sources/` 存放链上合约，`scripts/` 管理部署与运维命令，`Move.toml` 为包配置。
- `packages/shared/`：跨前后端复用的 TypeScript 代码，涵盖 DTO、GraphQL 查询封装与环境配置入口。
- `docs/`：文档库，内含 `architecture/`（架构章节 1-9 与高层总览）、`prd/`（PRD 章节与校验记录）、`epic/`（史诗定义）、`stories/`（故事卡）、`qa/gates/`（质量结论）、`detail/`（补充细节），并提供 `architecture.md`、`prd.md`、`runbook.md` 索引。
- `hasura/`：Hasura GraphQL 引擎的元数据、数据源定义与查询集合。
- `scripts/`：自动化脚本集合，如 `setup-local.sh` 用于一键初始化工作区。
- `tooling/`：CI/CD、Lint、基础设施模板占位目录。
- `.bmad-core/`、`.codex/`、`.claude/`：多代理协作所需的指令、任务与配置。
- 顶层配置文件（`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json` 等）统一各 workspace 的依赖、脚本与编译参数。

### Docs Directory Map
```
docs/
├─ architecture/      # 系统架构分册（章节 1-9、高层概览）
├─ epic/              # 史诗文档
├─ prd/               # 产品需求文档
├─ qa/gates/          # QA 质量结论
├─ stories/           # 用户故事
├─ detail/            # 技术细节补充
├─ architecture.md    # 架构索引
├─ prd.md             # PRD 索引
└─ runbook.md         # 运维手册
```

## Architecture Overview

### System Layering（摘自《2-系统分层概览》）
- **前端层（`apps/web`）**：Next.js + `@aptos-labs/wallet-adapter-react`，承载角色仪表盘、订单时间线、媒体上传、质押与理赔界面，直接驱动钱包交互。
- **BFF / 服务层（`apps/bff`）**：NestJS 提供钱包签名辅助、费用计算、媒体上传与 blake3 哈希校验，并聚合 Hasura/Indexer 的只读数据。
- **链上 Move 模块**：`registry`、`orders`、`staking`、`insurance` 等模块部署于 Aptos，管理可信状态与事件，前端与 BFF 通过官方 RPC 完成交易提交流程。
- **数据与集成**：链上事件由 Aptos Indexer GraphQL 提供，链下媒体暂存本地磁盘并由 BFF 管理，可选 Hasura + Postgres 维护运营与缓存数据。
- **交互拓扑**：用户 → 钱包 → 前端；前端同步调用 BFF API 与 Aptos RPC，BFF 负责与 MediaStore、Hasura、Indexer 协同完成读写闭环。

### High-Level Highlights（摘自《High Level Architecture》）
- **技术栈**：Monorepo（pnpm workspaces）统一前端、后端、Move 合约与共享包，GitHub Actions 负责 Move 测试、BFF 构建、前端构建流水线。
- **前端体验**：Next.js 配合 i18next、Day.js 提供多语言与多时区支持，钱包适配器内嵌完成交易签名流程。
- **后端职责**：NestJS BFF 聚合 Aptos Indexer 数据并管理链下媒体上传/校验，Hasura + Postgres 保存运营、缓存等补充信息。
- **数据策略**：核心业务数据依赖 Aptos Indexer GraphQL，链下媒体定期备份；PoC 阶段先使用本地磁盘，后续逐步迁移 OSS。
- **基础设施推荐**：阿里云（ECS + RDS + OSS）适合作为测试网 PoC 部署基座，后续可视需求扩展到多云或托管方案。

> 深入细节请参阅 [`docs/architecture/2-系统分层概览.md`](docs/architecture/2-系统分层概览.md) 与 [`docs/architecture/high-level-architecture.md`](docs/architecture/high-level-architecture.md)。

## Prerequisites
- Node.js 18+
- Docker & Docker Compose (for Postgres/Hasura stack and optional Move CLI fallback)
- Aptos CLI (or rely on the Docker fallback)
- pnpm 8 (enabled through Corepack)

## Quick Start
1. **Bootstrap the workspace**
   ```bash
   scripts/setup-local.sh
   ```
   - Ensures Corepack/pnpm are enabled, installs dependencies, and copies `.env.example → .env.local` when missing.
   - Set `START_DOCKER=true` beforehand if you want the Postgres/Hasura stack (`docker/compose.poc.yml`) to auto-start.
2. **Apply Prisma migrations & prepare media storage**
   ```bash
   export DATABASE_URL="postgres://haigo:haigo@localhost:5433/haigo"
   pnpm --filter @haigo/bff prisma:migrate:deploy
   mkdir -p storage/media
   ```
   This provisions the new `media_assets` table and ensures `MEDIA_STORAGE_DIR` points to a writable folder.
3. **Run the services**
   ```bash
   pnpm --filter @haigo/bff start:dev   # BFF available on http://localhost:3001
   pnpm --filter @haigo/web dev         # Web app on http://localhost:3000
   ```
4. **Verify** – open http://localhost:3000 in your browser and confirm media uploads hit the BFF (watch the terminal for `/api/media/uploads`).

> Need to rerun migrations later? Just repeat step 2 with the appropriate `DATABASE_URL`.

## Workspace Commands
| Command | Description |
|---------|-------------|
| `pnpm dev:web` | Start the Next.js application on port 3000. |
| `pnpm dev:bff` | Start the NestJS BFF on port 3001 with live reload. |
| `pnpm move:compile` | Compile Move modules via the Aptos CLI or Docker fallback (`APTOS_DOCKER_IMAGE` to override). |
| `pnpm move:test` | Run Move unit tests via the Aptos CLI or Docker fallback (`APTOS_DOCKER_IMAGE` to override). |
| `pnpm lint` | Execute linting across all packages. |
| `pnpm test` | Run package test scripts (placeholders today). |
| `pnpm --filter @haigo/bff prisma:migrate:deploy` | Apply Prisma migrations (requires `DATABASE_URL`). |
| `pnpm build` | Build frontend and backend bundles. |

## Environment Variables
Configuration lives in `.env.local`. Copy from `.env.example` and adjust values for your environment. Key variables:
- `NEXT_PUBLIC_HASURA_URL` / `NEXT_PUBLIC_BFF_URL` for frontend connectivity.
- `APTOS_INDEXER_URL` for on-chain data access.
- `POSTGRES_*` for database credentials.
- `MEDIA_STORAGE_DIR` for local media storage (defaults to `./storage/media`).
- `MEDIA_PUBLIC_PREFIX` (optional) for exposing uploaded media through a static path (defaults to `/media`).

## Continuous Integration
GitHub Actions workflow `ci.yml` runs on every push and pull request:
1. `move-test` compiles and tests Move code, uploading `move/build/` artifacts.
2. `backend-test` lints and builds the NestJS BFF, publishing the compiled `dist/` folder zipped for deployments.
3. `frontend-build` runs lint + build for the Next.js app, uploading the `.next/` build artifacts along with configuration files for deployment.

Artifacts can be downloaded from the workflow summary for downstream deployment steps.

## Troubleshooting
- Ensure the Aptos CLI is on your PATH, or rely on Docker (used automatically when the CLI is missing).
- Delete `node_modules` and rerun `scripts/setup-local.sh` if dependency installation fails.
- Use `pnpm --filter <package> <command>` to target individual workspaces.

Happy hacking!
