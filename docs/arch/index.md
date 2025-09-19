# Architecture Index

欢迎使用 Haigo Anchor 文档。本目录提供九个核心章节与 Anchor 指引，确保文档与代码一一对应。

| 顺序 | 文档 | 重点 |
|------|------|------|
| 1 | [Foundation](./01-foundation.md) | Monorepo 结构、核心 Anchor 约定。 |
| 2 | [Operations](./08-operations.md) | 环境配置、部署、日志运维。 |
| 3 | [Global Architecture Diagram](./02-global-architecture-diagram.md) | 全局拓扑与组件 Anchor。 |
| 4 | [Data Flows](./03-data-flows.md) | 端到端场景、实现状态与未来规划。 |
| 5 | [Share Types](./04-share-types.md) | DTO/配置常量的统一来源。 |
| 6 | [Contracts](./05-contracts.md) | Move 模块细节与部署策略。 |
| 7 | [BFF](./06-bff.md) | NestJS 模块、事件轮询、REST 接口。 |
| 8 | [Frontend](./07-frontend.md) | Next.js 页面、Hook、测试策略。 |
| 9 | 未来更新 | 新增章节请在此表补充顺序与链接。 |

> 维护流程：新增模块或重大改动时，先更新对应文档中的 Anchor，再推进代码变更；每次 Story 完成后验证 Anchor 是否仍指向正确行号。
