# High Level Architecture

## Technical Summary
- 架构风格：前后端一体的 Monorepo，链上 Move 模块负责可信状态，链下 BFF 聚合官方 Aptos Indexer 与自有元数据，前端直接面向钱包交互。
- 前端：Next.js + `@aptos-labs/wallet-adapter-react`，结合 i18next/Day.js 支撑多语言多时区。
- 后端：NestJS BFF 负责只读聚合、媒体上传、Hash 校验；本地 Postgres/Hasura 存放媒体、运营衍生数据。
- 数据与集成：核心链上数据全部从 Aptos 官方 Indexer GraphQL 获取，链下媒体暂存在服务器磁盘并定期备份。
- 基础设施：PoC 部署在测试网与云主机（阿里云 ECS 或等效服务），CI 以 GitHub Actions 为主，输出 Move 编译/测试 + 前后端构建。
- PRD 目标达成：满足 FR1–FR10 的链上身份、订单状态机、质押/理赔事件；NFR1–NFR8 通过钱包签名、媒体哈希、本地备份、监控告警策略逐步落实。

## Platform and Infrastructure Choice
| 选项 | 优点 | 局限 |
|------|------|------|
| 阿里云（ECS + RDS + OSS） | 中国团队运维熟悉、区域覆盖、便于未来迁移 OSS | PoC 阶段成本略高，需要额外配置基础设施 | 
| Vercel + Supabase | 快速部署 Next.js、内建 Postgres 存储 | 对 Aptos Move/BFF 自定义服务支持不足，媒体上传有限制 |
| AWS（EC2 + RDS + S3） | 全球可用、配套完善 | 成本相对高、合规审计需额外工作 |

**推荐方案**：阿里云测试网部署。利用 ECS 运行 BFF/Hasura，RDS/Postgres 托管链下数据；后续迁移 OSS 替代本地磁盘。正式化阶段可再评估多云或托管方案。

## Repository Structure
- 采用 npm workspaces + custom tooling：
  - `move/`：Aptos Move 合约与脚本。
  - `apps/web`：Next.js 前端应用。
  - `apps/bff`：NestJS BFF 服务。
  - `packages/shared`：共享 TypeScript 类型、配置、GraphQL 查询封装，统一以 ESM 分发，供 Web/BFF 共用。
  - `docs/`：需求、架构、Runbook 文档。
- 根目录维护统一的 lint/test 脚本；CI 按 workspace 区分任务。

```text
haigo/
├─ move/
│  ├─ sources/                 # Move 模块源文件
│  ├─ scripts/                 # 部署与运维脚本
│  └─ Move.toml
├─ apps/
│  ├─ web/                     # 前端 Next.js 应用
│  │  ├─ app/                  # App Router 页面与布局
│  │  ├─ components/           # UI 组件（含 shadcn 封装）
│  │  ├─ features/             # 领域模块（订单、理赔等）
│  │  └─ lib/                  # 钱包、i18n、API 客户端
│  └─ bff/                     # NestJS BFF 服务
│     ├─ src/
│     │  ├─ modules/           # 领域模块（orders、claims 等）
│     │  ├─ infrastructure/    # 数据访问层（Hasura/Indexer/存储）
│     │  ├─ common/            # DTO、拦截器、中间件
│     │  └─ main.ts
│     └─ test/
├─ packages/
│  └─ shared/
│     ├─ src/
│     │  ├─ dto/               # 共享 DTO/类型定义
│     │  ├─ gql/               # GraphQL 查询与 Hook 封装
│     │  └─ config/            # 合约地址、环境配置
│     ├─ dist/                 # 构建输出（ESM/.d.ts）
│     └─ index.ts
├─ docs/                       # PRD、架构、故事等
└─ tooling/                    # Lint、CI、Terraform/Ansible 模板（PoC 可选）
```

## Package Architecture & Boundaries
- **分层依赖**：所有 `apps/*` 仅消费 `packages/*` 与 `move/` 导出的接口；`packages/*` 不允许反向依赖 `apps/*`，确保可被多应用复用。
- **共享产物**：`packages/shared` 采用 `type: module`，通过 `exports` 字段暴露 `dist/` 下的 ESM 与 `.d.ts`，构建命令 `pnpm --filter @haigo/shared build` 必须在其它 workspace 构建前执行。
- **面向未来的扩展位**：预留 `packages/contracts`（封装 Move ABI）、`packages/tooling`（脚本与 CLI）等子包位置，保持 Monorepo 下横向扩展不破坏现有依赖图。
- **构建顺序**：
  1. `packages/shared`: `tsc` 产出 `dist`，生成 `.js` 与 `.d.ts`。
  2. `apps/bff`: `tsc` 基于 NodeNext 解析；运行时通过 Node 原生 ESM、`tsx`（开发态 watch）加载。
  3. `apps/web`: Next.js 直接消费 `packages/shared/dist`，同时可通过 `tsconfig` paths 指向 `src` 以获得热更新。

### Boundary Matrix
| 层级 | 包 | 角色 | 产物 | 上游依赖 | 下游消费者 |
|------|----|------|------|----------|-------------|
| Core Contracts | `move` | Aptos Move 模块与脚本 | `build/`、ABI JSON | - | `packages/contracts`（规划）、`apps/bff` 部署脚本 |
| Shared Library | `packages/shared` | DTO、环境配置、GraphQL 查询 | `dist/*.js` + `*.d.ts` | `move` ABI（未来）、环境配置 | `apps/bff`、`apps/web` |
| Backend | `apps/bff` | NestJS BFF、媒体存储、链下聚合 | `dist/main.js` | `packages/shared`、Postgres/Hasura | 前端、外部客户端 |
| Frontend | `apps/web` | Next.js 客户端、管理后台 | `.next/`、静态资源 | `packages/shared`、BFF HTTP | 最终用户 |

### ESM Strategy
- **NodeNext 配置**：所有 TypeScript 项目统一启用 `moduleResolution: "NodeNext"` 与 `.js` 扩展导出，避免 CJS/ESM 混用导致的运行时错误。
- **路径映射**：各应用的 `tsconfig.json` 通过 `paths` 指向 `packages/shared/src`，开发态保持源码引用；构建态依赖编译后的 `dist/`。
- **动态导入规范**：约定跨包动态导入必须使用相对 `.js` 后缀或 `exports` 映射，确保 Node 18+ 与 bundler 均可解析。
- **工具链兼容性**：开发模式使用 `tsx watch`（基于 esbuild/Node ESM），避免 `ts-node-dev` 与 NodeNext 的兼容坑；生产构建统一通过 `tsc`，禁止使用 Babel 转译。

### Workspace Scripts
| 命令 | 描述 | 备注 |
|------|------|------|
| `pnpm install` | 安装依赖、生成 `pnpm-lock.yaml` | Monorepo 引导脚本，CI 必跑 |
| `pnpm --filter @haigo/shared build` | 编译共享库 | 生成 `dist`（ESM），需在其它包前执行 |
| `pnpm --filter @haigo/bff build` | NestJS 编译 | 读取 `packages/shared/dist`，输出 `dist/main.js` |
| `pnpm --filter @haigo/web build` | Next.js 产出 | 依赖 BFF API Schema 与 Shared DTO |
| `pnpm dev` | 并行启动所有应用 | 包含 `web` 与 `bff` 的开发模式，无测试环境 |
| `pnpm lint` / `pnpm test` | 全仓库 Lint/Test | 利用 pnpm workspace 传播 |

### Module Ownership
- **Domain Teams → packages/shared**：负责定义 DTO、GraphQL Fragment、常量，需与 Move 模块保持同步。
- **Backend Team → apps/bff**：确保 `NodeNext` 配置、`ts-node` 生命周期、Prisma/Hasura 同步。
- **Frontend Team → apps/web**：消费 Shared DTO，并通过 webpack/Next.js alias 保持类型一致性。
- **DevOps Team → tooling/**：维护 CI、IaC、Bootstrap 脚本，保证环境之间构建链条一致。
