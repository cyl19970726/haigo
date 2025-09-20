# W1-001 Storage Fee & Insurance Alignment Plan

## 1. Background
- PRD FR3 要求：商家创建订单时一次性支付“存储费 + 保险费”，仓库在订单完成（出库）后获得应得存储费。
- 当前实现：
  - Move `orders::create_order` 仅处理 `{ amount, insurance_fee, platform_fee }` 总额转账给平台账户。
  - `staking::set_storage_fee` 仅记录 bps 值，并未参与订单定价或结算。
  - `OrderCreated` 事件及链下 DTO 使用 `platform_fee` 字段；前端 UI 也以“Platform fee”呈现，与业务不符。
  - 保险费率默认 2.5%（可编辑），未限制在“商品价值 1%”范围。
- 目标：实现与规范一致的费用拆解、结算流程与 UI 表达，同时兼容现有监听/缓存体系。

## 2. Scope & Deliverables
- 更新 Move 合约、共享 DTO、BFF、前端以支持如下流程：
  1. 订单创建时按照仓库 `storage_fee_bps` 计算存储费，写入链上 `PricingRecord.storage_fee`。
  2. 保险费按商品金额 1%（支持上限）计算并写入 `PricingRecord.insurance_fee`，可扩展读取配置。
  3. OrderCreated 事件与链下数据层同步携带新的存储费字段。
  4. 出库阶段记录或触发存储费结算（直接链上转账或事件通知）。
  5. FE 订单向导、Dashboard 等界面统一展示 `Storage fee`、`Insurance fee`。
- 文档更新：架构文档（3/4/5/10 章）与 PRD 对应段落同步。

## 3. Workstream Breakdown
1. **Move Layer**
   - 修改 `move/sources/orders.move`：
     - `PricingRecord` 将 `platform_fee` 重命名为 `storage_fee`。
     - `create_order` 入参增加 `storage_fee` 或在函数内部调用 `staking::get_storage_fee` 计算费用。
     - 新增 `StorageFeeSettled` 事件或扩展 `CheckedOut`，标明仓库应收费用及结算状态。
     - 更新测试（`test_stake_and_fee_flow` 等）覆盖新字段。
   - 如需保持平台佣金，引入独立字段 `platform_fee` 并在链上区分资金流。
2. **Shared DTO & Packages**
   - 更新 `packages/shared/src/dto/orders.ts`：
     - `PricingBreakdown` 字段改为 `storageFeeSubunits`。
     - 调整 `calculatePricing` 根据仓库 fee 预设计算存储费。
   - 更新 `packages/shared/src/config/orders.ts`，限制保险费率（默认 1%，定义最大值）。
3. **Database & BFF**
   - Prisma 迁移：`orders`, `order_events` 添加/重命名字段，将 `platform_fee_subunits` → `storage_fee_subunits`。
   - 更新 `OrdersRepository`、`OrdersEventListener` 映射逻辑；确保 `WarehouseSummary.feePerUnit` 与订单费用挂钩。
   - Notification/settlement：若存储费在链下结算，添加 BFF API 或监听事件生成待结算记录。
4. **Frontend**
   - 订单创建向导：
     - 移除“Platform fee”输入；展示仓库提供的 `Storage fee`（不可编辑或限定范围）。
     - 保险费默认 1%，可提供区间内调整；校验 `amount * 1%`。
   - Dashboard/目录：统一展示 `Storage fee`，并在订单摘要和收件箱中显示。
   - 更新 `WarehouseStakingCard` 及 Quick Actions 文案，呼应新的费用逻辑。
5. **Testing & Verification**
   - Move 单测：新增覆盖 storage fee 计算、结算事件。
   - BFF：单元/集成测试覆盖新字段、迁移路径（旧数据兼容策略）。
   - 前端：调整现有单测/Story，加入保险费校验测试。
   - 手动验收脚本：
     1. 仓库设置 fee=50bps → 商家下单 → 订单详情显示 storage fee。
     2. 保险费 1% → UI、链上事件、BFF 返回一致。
     3. 出库后验证仓库收到或至少记录待领取金额。

## 4. Migration & Rollout
- 迁移策略：
  - 编写 Prisma migration → 运行 `pnpm --filter @haigo/bff prisma migrate dev`。
  - 部署顺序：Shared 包 → Move 合约（storage fee 变更）→ BFF 监听重启 → 前端。
  - 旧数据兼容：
    - 为已有订单提供迁移脚本（platform_fee 迁移到 storage_fee）。
    - 监听器在读取旧事件时默认 `storage_fee = platform_fee`。
- 回滚方案：备份旧合约模块地址，提供 feature flag 保留旧字段。

## 5. Open Questions
- 存储费是否应支持多日计费？当前需求为“一次性”，若未来要按天结算需重新设计。
- 出库结算是否一定链上完成，或允许链下对账？需与产品确认。
- 是否需要平台佣金字段？如需要，应与 storage fee 并行存在。

## 6. Next Steps
1. 获取产品/合约团队确认：一次性存储费 + 保险 1% 是否为长期策略。
2. Draft Move 合约改动方案，估算 Gas 与兼容性。
3. 启动 `packages/shared` & BFF DTO 重命名 PR。
4. 准备合约部署脚本与测试计划。

> 此计划在主计划（Quick Actions 改造）交付后启动，完成后需回写进 `.agent-context/W1-质押/integration-plan.md` 的进度与结论。
