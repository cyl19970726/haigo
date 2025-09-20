# fix-seller.md — Seller 仓库目录缺失排查与修复计划

## 1. 现状与影响
- 仓库钱包已成功在链上完成 `staking::stake`，BFF 侧 `GET /api/staking/:address` 可以通过 Move view 读取实时质押金额。
- 然而 `/api/warehouses?available=true` 仍返回空数组，导致 `/dashboard/seller` 页面仓库目录始终空白，商家无法继续下单流程。
- `SellerWarehouseDirectoryCard` 默认勾选“仅显示可用”，只展示 `availability === 'available'` 的仓库；当前聚合层将所有仓库标记为 `limited`，连带影响后续的下单联动（CTA 打开但无仓库可选）。

## 2. 初步根因分析
- `DirectoryRepository.mergeWarehouseData` 依赖 `prisma.stakingPosition` 与 `storageFeeCache` 表决定 `stakingScore / feePerUnit / availability`，若表中缺少最新质押快照，则 `resolveAvailability` 退化为 `'limited'`。
- `apps/bff/src/modules/staking/staking.listener.ts` 负责监听 `StakeChanged` / `StorageFeeUpdated` 事件写入上述表，但目前测试环境中：
  1. **事件监听没有消费到新事件**（可能因为 Indexer GraphQL URL、模块地址或游标初始化配置不匹配）；
  2. 即便监听成功，目录聚合也缺乏兜底逻辑，在缓存缺失时不会调用 Move view 读取实时数据。
- 结果：Seller 目录对链上最新状态不敏感，需要等待后端手动补数据才能展示。

## 3. 修复目标
1. **事件流正确入库**：`staking_positions` / `storage_fees_cache` 在新质押后能及时写入，`availability` 判定正确更新为 `available`。
2. **目录聚合具备兜底能力**：当缓存缺失或落后时仍可通过 Move view 查询最新质押信息，避免前端长时间显示空列表。
3. **前端回显与文案调整**：Seller 目录在无可用仓库时给出明确提示，并允许用户切换查看全部仓库以确认状态。
4. **测试&观测**：添加单元/集成测试覆盖新逻辑，并在 BFF 日志/metrics 中记录事件摄取与目录兜底命中情况，便于运维监控。

## 4. 迭代工作项

### 4.1 事件监听排查与修复
- [ ] 校验 StakingListener 配置：确认 `indexerUrl` 指向有效的 GraphQL 端点，`NEXT_PUBLIC_APTOS_MODULE` 与部署脚本输出一致。
- [ ] 在本地/测试环境开启调试日志（或增加临时日志）观察 `fetchEvents` 返回值，定位是否因游标、权限或网络错误导致 0 条事件。
- [ ] 若是游标初始化问题，增加 `backfillOffsetVersions` 或手动重置 `staking_positions` 游标以拉取最新事件。
- [ ] 编写/完善集成测试（可 mock Indexer 响应）确保 `StakeChanged` 事件能触发 `upsertStake`，`stakedAmount` 按 `new_amount` 更新。

### 4.2 目录聚合兜底
- [ ] 在 `DirectoryRepository.list` 中，当 `positionMap` 未包含某仓库时，调用 `StakingService.getIntent`（或抽出一个轻量 helper）获取实时 `stakedAmount`、`feePerUnit`；
      - 需要注意避免 N+1：可批量或并行调用 view 接口（限定在缓存 miss 的少数仓库）。
- [ ] 根据兜底结果更新 `stakingScore`/`creditCapacity`/`availability` 计算逻辑（至少保留 `stakedAmount > 0` → `available`）。
- [ ] 对兜底过程添加缓存/TTL（例如内存 map）以减少频繁的 on-chain view 调用。
- [ ] 新增单元测试覆盖“缓存缺失但 view 返回数据”与“view 失败 fallback”场景，确保不会抛异常。

### 4.3 前端体验策略
- [ ] `SellerWarehouseDirectoryCard` 在 `available=true` 且返回空数据时，提示“链上质押正在同步，请稍后或取消勾选”并提供入口取消筛选。
- [ ] 若仓库列表重新获得数据，确保 CTA 可以正常跳转或触发下单流程（回归测试）。
- [ ] 可选：在卡片底部显示 `generatedAt` 与 `cacheHit` 字段，帮助判断数据是否实时。

### 4.4 运维与文档
- [ ] 更新 `.agent-context/intergation/improve-seller-page.md` 或相关文档，补充 staking ingest → directory → front-end 的数据流说明，标注兜底逻辑。
- [ ] 在部署脚本/Runbook 中增加“如何重置 staking 监听游标、如何手动触发兜底”步骤。
- [ ] 回填 QA 检查清单：质押后 5 分钟内目录可见、勾选/取消 `仅显示可用` 行为正确、下单流程可串联。

## 5. 风险与待确认事项
- Move view 兜底在高频调用下的性能/费用；需要评估是否限制并发或采用批量 RPC。
- Indexer GraphQL 端口若需认证，应在配置中补齐 token，并确保部署环境注入。
- 目录兜底逻辑加入后，需观察是否与缓存 TTL/分页产生不一致（应在返回 `meta.generatedAt` 中区分数据来源）。

> 完成以上工作后，Seller 仓库目录应能在质押成功后立即展示可用仓库，支撑后续下单链路，同时具备清晰的监控与文档支持。
