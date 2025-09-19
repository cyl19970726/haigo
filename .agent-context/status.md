# 项目场景进度状态（.agent-context/status.md）

| 场景 | 编号 | 说明 | 状态 | 计划 | 变更追踪 |
|------|------|------|------|------|----------|
| 注册事件同步 | R1 | 账户注册事件与兜底 | 已完成 | .agent-context/R1 | .agent-context/R1/changes.md |
| 档案哈希校验 | R2 | BLAKE3 校验 | 已完成 | .agent-context/R1 | .agent-context/R1/changes.md |
| 家庭仓质押/存储费 | W1 | 质押仓位与费率设置 | 规划中 | .agent-context/W1/W1-implementation-plan.md | .agent-context/W1/changes.md |
| 家庭仓 Listing | L1 | 商家选择家庭仓 | 规划中 | .agent-context/L1/L1-implementation-plan.md | .agent-context/L1/changes.md |
| 订单创建与链上签署 | O1 | 商家创建订单 | 初版完成 | .agent-context/O1/O1-implementation-plan.md | .agent-context/O1/changes.md |
| 仓库订单收件箱 | W2 | 仓库看到被下单订单 | 规划中 | .agent-context/W2/W2-implementation-plan.md | .agent-context/W2/changes.md |
| 仓储出库与媒体上传 | O2 | 出库签署与媒体对账 | 规划中 | .agent-context/O2/O2-implementation-plan.md | .agent-context/O2/changes.md |
| 商家评价 | M1 | 对仓库订单评价 | 规划中 | .agent-context/M1/M1-implementation-plan.md | .agent-context/M1/changes.md |

说明：
- “初版完成”表示最小可用链路已联通（API + 监听 + 最小前端集成）。
- 更新状态时，请同时维护对应 changes.md 与 docs/architecture/10.* 章节 Anchor。
