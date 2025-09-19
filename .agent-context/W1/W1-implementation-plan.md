# W1 家庭仓质押与存储费设置 — 实施计划

## 目标
- 家庭仓可完成 stake/unstake；BFF 聚合质押仓位；允许设置 storage_fee（链下配置）。

## 步骤
1) BFF Staking 模块（planned）：`apps/bff/src/modules/staking/*`
- Controller: GET /api/staking/intent, POST /api/staking/storage-fee
- Listener: 解析 StakeChanged（Fullnode 兜底）
- Repository: staking_positions 表（planned）
2) FE：`StakingDashboard` with `useStakingIntent`

## 测试
- 模拟 StakeChanged → positions 更新
- storage_fee 更新接口鉴权与持久化

## 验收
- 接口返回当前质押与可设费率；设置费率成功并在 Listing 生效
