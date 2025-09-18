# Epic 1: Infrastructure & On-chain Registration (基础设施与链上注册)
**目标**：在 Aptos 上部署基础合约，搭建 Monorepo 工程、持续集成与前端钱包接入，确保商家与仓主能够完成链上注册以及链下档案哈希绑定。

## 跨故事统一要求
- PoC 阶段统一使用 `docker/compose.poc.yml` 启动 Postgres、Hasura 数据服务，BFF/Web 在宿主机运行；团队成员须按照《docs/architecture/6-部署与环境.md#61-本地-docker-poc-环境》准备环境并在每个故事交付时验证连通性。

## Story 1.1 Monorepo & CI/CD Foundations (Monorepo 与 CI/CD 基座)
> 作为平台工程团队，我希望搭建 Monorepo 结构、基础包管理与 CI/CD 流水线，以便后续 Move 合约、后端与前端协同开发并自动化验证质量。

接受标准：
1: Monorepo 初始化后包含 `move/`、`apps/web`、`apps/bff` 与 `packages/shared` 等工作空间，并提供启动脚本。
2: Move、后端、前端依赖安装与环境配置脚本齐备，README 记录运行方式。
3: CI/CD 执行 Move 编译+单测、后端 lint/test、前端 lint/build，全部通过才允许合并。
4: Pipeline 生成构建工件或部署包，并在日志或文档中记录。

## Story 1.2 Core Account Move Module (核心账户 Move 模块)
> 作为合约开发者，我希望实现并部署账户注册 Move 模块，使商家与仓主地址可以在链上创建身份并存储档案哈希。

接受标准：
1: 实现 `register_seller`、`register_warehouse`，校验调用者并存储档案哈希。
2: 触发 `SellerRegistered`、`WarehouseRegistered` 事件，包含地址与哈希信息。
3: Move 单元测试覆盖成功注册、重复注册与越权访问等场景。
4: 提供部署脚本/说明，能在测试网发布并记录模块地址。

## Story 1.3 Frontend Wallet Connection & Identity Selection (前端钱包连接与身份选择)
> 作为商家或仓主，我希望在前端连接 Aptos 钱包并选择角色，完成链下资料上传与哈希绑定，以便创建受信任的账户。

接受标准：
1: 集成 Petra/Martian 等钱包，显示当前地址与网络状态。
2: 身份选择 UI 支持上传档案文件并计算内容哈希。
3: 通过钱包签名调用 `register_*`，展示 Gas 预估与交易状态，成功后提示区块浏览器链接。
4: 档案文件上传至对象存储，返回哈希与元数据并与链上记录一致。

## Story 1.4 Metadata Indexing & Record Verification API (元数据索引与档案校验接口)
> 作为后端开发者，我希望监听注册事件并暴露查询接口，让前端与平台运营能够检索账户信息并验证链下档案哈希。

接受标准：
1: 监听 `SellerRegistered` / `WarehouseRegistered` 事件并写入 Postgres。
2: 提供 REST/BFF 接口返回账户档案（地址、角色、哈希、注册时间）。
3: 实现哈希验证 API，可对链下档案重新计算哈希并与链上比对。
4: 集成测试覆盖事件消费、数据库写入与哈希验证流程。
5: 上述功能需在 Docker Compose 环境中完成端到端验证（仅 Postgres/Hasura 容器，参照 docker/compose.poc.yml），并确保宿主机 BFF/Web 可以连接对应服务。
