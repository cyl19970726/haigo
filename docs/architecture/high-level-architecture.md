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
  - `packages/shared`：共享 TypeScript 类型、配置、GraphQL 查询封装。
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
│     └─ index.ts
├─ docs/                       # PRD、架构、故事等
└─ tooling/                    # Lint、CI、Terraform/Ansible 模板（PoC 可选）
```

