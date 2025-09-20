# W1 变更摘要与验收（草案）

## 代码（planned）
- Move: staking.move 扩展 stake/unstake/set_storage_fee + 事件 + 视图 + 单测
- BFF: staking.module/controller/service/listener/repository + Prisma 缓存模型
- FE: StakingDashboard + hooks；钱包签名 stake/unstake/set_storage_fee

## 文档
- 更新：docs/architecture/3-链上合约设计.md（3.5.1–3.5.3）
- 更新：docs/architecture/4-链下服务与数据流.md（4.9 W1 小节）
- 更新：docs/architecture/10-场景化端到端数据流.md（10.4 流程调整为链上写入费率）
- 更新：docs/front-end-spec.md（Dashboard ASCII 与交互）
- 更新：docs/arch/04-share-types.md（Staking 事件 DTO 草案）

## 指标
- staking_listener_last_version / staking_listener_error_total（planned）

## 验收
- intent 返回 stakedAmount/feePerUnit；stake/set_storage_fee 后 30s 内刷新；日志与指标正常
