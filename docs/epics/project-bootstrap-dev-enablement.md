# Project Bootstrap & Developer Enablement Epic

## Epic Goal
建立统一的 HaiGo 单仓代码仓库与本地开发体验，确保 Move 合约、Next.js 前端与只读 BFF 可以被快速拉起并通过一致的质量门禁。

## Epic Description

### Existing System Context
- Current relevant functionality: 尚无既有代码，PRD 与架构文档已经定稿，需要按照 Architecture v1.0.1 的栈组合（Move + Next.js + Node BFF）落地。
- Technology stack: Move/Aptos、Next.js + TypeScript、Node.js (Express)、Postgres、Redis、MinIO/S3。
- Integration points: Aptos fullnode/indexer、对象存储、Postgres/Redis。

### Enhancement Details
- What's being added/changed: 建立 monorepo（apps/web、apps/bff、move/warehouse_rwa、packages/shared），配置 pnpm workspace、Docker Compose、本地 env、质量脚本。
- How it integrates: 前端与 BFF 共享 TypeScript 包，BFF 通过 Docker 服务连接 Postgres/Redis，Move 模块通过 Aptos CLI 与本地链交互。
- Success criteria: 新成员 clone 仓库后 30 分钟内可通过 `pnpm dev` 拉起 web、bff、Move 单测；CI 能执行 lint/test/move:test 并产出构建工件。

## Stories
1. **Story 1:** Scaffold monorepo & tooling skeleton — 建立 pnpm workspace、apps/web Next.js 项目、apps/bff Express 服务、move/warehouse_rwa，加入 Husky/lint-staged 以及基础脚本。
2. **Story 2:** Provision local infrastructure & envs — 交付 Docker Compose（Postgres/Redis/MinIO）、`.env.example`、`pnpm run setup`/`db:setup` 脚本与文档。
3. **Story 3:** Document developer workflow & CI hooks — 撰写 README/CONTRIBUTING，定义 `pnpm dev`、`pnpm run prepush`、CI 流程（testnet 自动部署，mainnet 人审），并同步到 Architecture 的 Project Setup 段落。

## Compatibility Requirements
- [x] Existing APIs remain unchanged
- [x] Database schema changes are backward compatible
- [x] UI changes follow existing patterns
- [x] Performance impact is minimal

## Risk Mitigation
- **Primary Risk:** 多端技术栈配置不一致导致开发环境难以拉起。
- **Mitigation:** 统一脚本（setup/bootstrap/dev），Docker 化依赖，CI 预置环境校验。
- **Rollback Plan:** 如脚本失败，可回退到基础 pnpm workspace 模板，并逐项恢复脚本；保留初始 scaffold tag。

## Definition of Done
- [ ] All stories completed with acceptance criteria met
- [ ] Existing functionality verified through testing
- [ ] Integration points working correctly
- [ ] Documentation updated appropriately
- [ ] No regression in existing features

## Validation Checklist
- [x] Epic can be completed in 1-3 stories maximum
- [x] No architectural documentation is required
- [x] Enhancement follows existing patterns
- [x] Integration complexity is manageable
- [x] Risk to existing system is low
- [x] Rollback plan is feasible
- [x] Testing approach covers existing functionality
- [x] Team has sufficient knowledge of integration points
- [x] Epic goal is clear and achievable
- [x] Stories are properly scoped
- [x] Success criteria are measurable
- [x] Dependencies are identified

## Story Manager Handoff
"Please develop detailed user stories for this epic. Key considerations:

- This is a greenfield monorepo targeting Move/Next.js/Express/pg/redis/minio，工具链按 Architecture 文档新加的 Project Setup 段落执行
- Integration points: Aptos fullnode/indexer、对象存储（MinIO）、Docker 化的 Postgres/Redis
- Existing patterns to follow: Architecture v1.0.1 提供的直链交互模板、BFF OpenAPI、ContentHash 结构
- Critical compatibility requirements: CLI/脚本要可在 macOS + Linux 上运行；Docker 资源命名与后续部署对齐；Move 模块保持 `haigo::warehouse_rwa`
- 每个故事需验证 `pnpm run prepush`、`pnpm run move:test`、`pnpm lint/test` 均通过

The epic should deliver a reliable developer bootstrap while enabling the team to focus on 订单/质押/保险等核心业务。"
