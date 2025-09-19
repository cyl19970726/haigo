# W1 家庭仓质押与存储费设置 — 完整实现计划（Design → Steps → Tests）

> 参考 docs/architecture/10-场景化端到端数据流.md:10.4（家庭仓质押与存储费设置），本计划落地家庭仓（仓库角色）在前端完成质押/解押，并在 BFF/DB 侧聚合仓位与存储费率，支持 Listing 场景消费。与 3/4/5/6 章节锚点保持一致，复用现有 Accounts/Orders 监听与 Fullnode 兜底模式。
## 0. 上下文与需阅读文档
- 场景数据流：docs/architecture/10-场景化端到端数据流.md（10.1 总览、10.4 W1、10.5/10.6/10.7 与上下游关系）
- 链上设计：docs/architecture/3-链上合约设计.md（3.5 S1 守卫 + 3.5.1–3.5.3 W1 扩展 planned）
- 链下服务：docs/architecture/4-链下服务与数据流.md（4.9 W1 小节，模块与事件映射）
- 共享类型：docs/arch/04-share-types.md（已废弃，仅作历史参考）→ 本迭代以 `packages/shared/src/dto/staking.ts` 为唯一来源
- 前端体验：docs/front-end-spec.md（Dashboard ASCII + 交互）；注册后重定向 .agent-context/R1/R1-registration-redirect-plan.md
- 部署与环境：docs/architecture/6-部署与环境.md（统一 .env.local、Aptos 网关、监听参数）

注意：`docs/arch/*` 文档已废弃，后续均以 `docs/architecture/*` 与 `packages/shared` 源码为准。

## 1. 目标与交付物
- FE：StakingDashboard（仓库面板），展示当前仓位与费率；按钮触发 stake/unstake/set_storage_fee（钱包签名）。
- BFF：Staking 模块（Controller/Service/Listener/Repository），监听 StakeChanged/StorageFeeUpdated，聚合 staking_positions 与 storage_fees_cache，仅作链上只读与缓存；接口提供 intent/summary 与（可选）历史曲线。
- 数据：staking_positions（事件聚合缓存），storage_fees_cache（费率缓存；权威来源为链上视图/事件）。
- 监控：新增 staking_listener_last_version / staking_listener_error_total（与 Accounts/Orders 监听一致）。

## 2. 跨层契约与 Anchors
- FE Anchors（planned）
  - apps/web/features/staking/StakingDashboard.tsx
  - apps/web/features/staking/hooks/useStakingIntent.ts
  - apps/web/app/(warehouse)/staking/page.tsx（路由占位，指向 Dashboard）
- BFF Anchors（planned）
  - apps/bff/src/modules/staking/staking.module.ts
  - apps/bff/src/modules/staking/staking.controller.ts
    - GET /api/staking/intent（读取链上视图→回落缓存）
    - GET /api/staking/:warehouseAddress（alias of intent with 显式地址）
    - GET /api/staking/:warehouseAddress/history（可选，供曲线）
  - apps/bff/src/modules/staking/staking.service.ts
  - apps/bff/src/modules/staking/staking.listener.ts（解析 StakeChanged/StorageFeeUpdated，Fullnode 兜底）
  - apps/bff/src/modules/staking/staking.repository.ts（读写 staking_positions / storage_fees_cache）
- Move Anchors（现有+planned）
  - move/sources/staking.move:1（现有 assert_min_credit）
  - planned: entry stake/unstake、set_storage_fee；events: StakeChanged, StorageFeeUpdated；views: get_stake/get_storage_fee

## 3. 数据模型（Prisma / Postgres）
```prisma
// planned — apps/bff/prisma/schema.prisma（缓存/聚合，权威来源为链上事件与视图）
model StakingPosition {
  warehouseAddress String  @id @map("warehouse_address")
  stakedAmount     BigInt  @map("staked_amount")
  lastTxnVersion   BigInt? @map("last_txn_version")
  lastEventIndex   BigInt? @map("last_event_index")
  updatedAt        DateTime @updatedAt @map("updated_at")

  @@map("staking_positions")
  @@index([lastTxnVersion, lastEventIndex])
}

model StorageFeeCache {
  warehouseAddress String @id @map("warehouse_address")
  feePerUnit       Int    @map("fee_per_unit") // 以基点或最小计费单位表示
  lastTxnVersion   BigInt? @map("last_txn_version")
  lastEventIndex   BigInt? @map("last_event_index")
  updatedAt        DateTime @updatedAt @map("updated_at")

  @@map("storage_fees_cache")
  @@index([lastTxnVersion, lastEventIndex])
}
```

## 3.1 共享类型（Share Types & DTO Index）
- 链上配置：packages/shared/src/config/aptos.ts（模块地址）
- Staking（planned）：packages/shared/src/dto/staking.ts
  - StakeChangedEventDto、StorageFeeUpdatedEventDto（字段见 docs/architecture/4-链下服务与数据流.md:4.10）
- 其他：错误码/常量按需在 packages/shared/src/config/* 内追加


实现提示：BigInt 字段在 Prisma/PG 映射为 `BIGINT`，BFF 层统一使用字符串传输，入库时转 `BigInt()`，与 Accounts/Orders 模式一致。

## 4. 实施步骤（含代码改动清单）
1) Move 合约扩展（planned）
- stake/unstake/set_storage_fee 三个入口 + 两类事件 + 两个视图；
- 单测用例：权限、上限/下限、事件载荷一致性、边界条件；
- 文档同步：3/4/5 章节与 share-types 补充。

2) BFF Staking 模块（代码骨架）
- Controller：GET /api/staking/intent（链上视图→回落缓存）
- Service：封装仓位与费率读取；
- Listener：订阅 StakeChanged/StorageFeeUpdated；Fullnode by_version 兜底；维护游标；
- Repository：CRUD staking_positions / storage_fees_cache；
- 代码改动：
  - apps/bff/src/modules/staking/{staking.module.ts,staking.controller.ts,staking.service.ts,staking.listener.ts,staking.repository.ts}（new）
  - apps/bff/prisma/schema.prisma + migrations（新增两表）
  - apps/bff/src/modules/app.module.ts 引入 StakingModule
  - /metrics 指标扩展 staking_listener_*（planned）

3) 前端对接
- 页面：apps/web/app/dashboard/warehouse/page.tsx；容器：apps/web/features/dashboard/WarehouseDashboard.tsx
- Hook：apps/web/features/staking/hooks/useStakingIntent.ts（intent 读取）
- 操作：调用钱包 stake/unstake/set_storage_fee；操作成功后刷新 intent；

4) 观测与补偿
- 指标：staking_listener_last_version/staking_listener_error_total；
- 补偿：后台任务回扫缺失游标；

5) 环境与配置（新增）
- 统一读取 Aptos 网关：
  - `APTOS_INDEXER_URL=https://api.testnet.aptoslabs.com/v1/graphql`
  - `APTOS_NODE_API_URL=https://api.testnet.aptoslabs.com/v1`
  - 可选：`APTOS_NODE_API_KEY=aptoslabs_...`（BFF 同时附带 Authorization 与 x-aptos-api-key）
- 监听参数（Staking 专用；默认为 Accounts/Orders 同步值）：
  - `STAKING_INGESTOR_INTERVAL_MS=30000`
  - `STAKING_INGESTOR_PAGE_SIZE=25`
  - `STAKING_INGESTOR_MAX_PAGES_PER_TICK=1`
  - `STAKING_INGESTOR_START_FROM_LATEST=true`
  - `STAKING_INGESTOR_BACKFILL_OFFSET_VERSIONS=0`
- 模块地址：复用 `NEXT_PUBLIC_APTOS_MODULE=0x<部署地址>` 拼接事件类型 `${MODULE}::staking::StakeChanged` 等。

## 5. 测试计划
- 单元：listener 分支（正常/兜底/错误），repository CRUD，controller 返回结构；
- 集成：回放 2–3 条 StakeChanged/StorageFeeUpdated 事件，验证 intent 刷新；
- 前端：Dashboard 卡片渲染、按钮触发签名（mock）与状态刷新；
— 端到端（选做）：在 Testnet 进行一次小额 stake 与 set_storage_fee，30s 内 FE 刷新成功。

## 6. 验收标准（Acceptance）
- 家庭仓在面板可看到 stakedAmount 与 feePerUnit；
- 提交 stake 后 ≤30s 内 intent 返回 stakedAmount 更新；
- 成功 set_storage_fee 后 ≤30s 内 intent 返回 feePerUnit 更新；
- 指标与日志：监听错误率 < 5%，回退/兜底路径有日志；
 - API 响应包含 `meta.source`（`onchain`/`cache`），便于 FE 标记显示来源。

## 7. 事件映射与 TS 接口（落地路径）
```ts
export interface StakeChangedEventDto {
  warehouse: string; delta: number; newAmount: number; timestamp: string;
  txnVersion: string; eventIndex: number; txnHash?: string;
}
export interface StorageFeeUpdatedEventDto {
  warehouse: string; feePerUnit: number; timestamp: string;
  txnVersion: string; eventIndex: number; txnHash?: string;
}
```
放置位置：`packages/shared/src/dto/staking.ts`；BFF/FE 共用。
## 8. 执行步骤（Checklist）
- [x] Move：实现 stake/unstake/set_storage_fee + 事件 + 视图 + 单测（已提交，含 #[view] 与基本用例）
- [x] BFF：staking.listener/controller/service/repository + Prisma 迁移（代码已提交；Service 已接入链上视图优先）
- [x] FE：StakingDashboard + hooks；调用钱包签名入口（已接线钱包签名与刷新）
- [x] Shared：新增 packages/shared/src/dto/staking.ts 并 `pnpm --filter @haigo/shared build`（已新增文件，待本地 build）
- [ ] 文档：更新 3/4/5 与 docs/arch/04-share-types.md；ASCII 已补（待更新架构文档锚点）
- [ ] 联调：testnet 模块地址配置 → 指标与日志验证

## 9. API 契约（草案）
- GET /api/staking/intent → 200
```json
{
  "data": { "warehouseAddress": "0x...", "stakedAmount": 120000000, "minRequired": 0, "feePerUnit": 25 },
  "meta": { "requestId": "...", "source": "onchain|cache" }
}
```
- 错误：429/5xx 按统一错误包返回；BFF 可回落缓存并带上 `source: 'cache'` 提示。
 - 可选：GET /api/staking/:warehouseAddress/history → 200 `{ "points": [{ "t": "ISO", "stake": 120000000, "fee": 25 }] }`

## 10. 风险、回滚与非目标
- 风险：Indexer 延迟/429（退避/兜底）；合约权限或上限设计变更（联动更新）；缓存不一致（回扫）；
- 回滚：关闭 staking 监听与卡片；FE 只读 intent；
- 非目标：不实现 slash/信用评分；不在 BFF 写费率（仅缓存）。

## 11. 代码改动清单与影响面
- Move：staking.move 扩展；tests；部署脚本输出模块地址；
- BFF：StakingModule 新增；/metrics 指标扩展；env 复用 APTOS_* 与 ORDER_INGESTOR_*（staking 自有变量可复用同名）；
- FE：Dashboard/Warehouse 卡片；hooks；钱包交互按钮；
- Shared：packages/shared/src/dto/staking.ts（planned）；
- Docs：3/4/5/10 与 04-share-types；

环境变量补充（BFF）：
- `STAKING_INGESTOR_*`（见“环境与配置”）；
- `NEXT_PUBLIC_APTOS_MODULE` 用于事件 type 拼接；
- `APTOS_INDEXER_URL`、`APTOS_NODE_API_URL`、`APTOS_NODE_API_KEY`。

## 12. 文档更新清单（完成后需回填）
- [ ] docs/architecture/3-链上合约设计.md（增加具体函数/事件行号）
- [ ] docs/architecture/4-链下服务与数据流.md（Staking 模块 anchors）
- [ ] docs/architecture/10-场景化端到端数据流.md（10.4 确认最终流程）
- [ ] docs/front-end-spec.md（Dashboard 卡片交互与无障碍）
- [ ] docs/arch/04-share-types.md（DTO 源路径更新，去除 staking DTO 的 planned 标记）

## 13. 复用与对齐（参考实现）
- Indexer 轮询 + Fullnode 兜底：参考 `apps/bff/src/modules/accounts/event-listener.service.ts` 的查询、`resolveTxnMetaByVersion`、退避策略与游标管理；StakingListener 复用同样的 header 注入与 cooldown 逻辑。
- 环境读取与默认值：参考 `apps/bff/src/common/configuration.ts` 与 `apps/bff/src/modules/orders/orders-event-listener.service.ts` 对 `ORDER_INGESTOR_*` 的覆盖方式，新增 `STAKING_INGESTOR_*` 对应项。
- FE 钱包签名/轮询：参考 `apps/web/features/registration/RegisterView.tsx:562` 的签名与确认模式，抽象到 `apps/web/features/staking/api.ts` 与 `useStakingIntent`。

## 14. Move 合约实现蓝图（函数/事件/视图/错误）
文件：`move/sources/staking.move`

函数签名（planned）：
- `public entry fun stake<CoinType>(warehouse: &signer, amount: u64)`
- `public entry fun unstake<CoinType>(warehouse: &signer, amount: u64)`
- `public entry fun set_storage_fee(warehouse: &signer, fee_per_unit: u64)`

事件（planned）：
```move
struct StakeChanged has store, drop {
  warehouse: address,
  delta: u64,
  new_amount: u64,
  timestamp: u64,
}

struct StorageFeeUpdated has store, drop {
  warehouse: address,
  fee_per_unit: u64,
  timestamp: u64,
}
```
事件句柄：`EventHandle<StakeChanged>`、`EventHandle<StorageFeeUpdated>` 存于模块资源中（如 `CreditBook` 或 `StakingBook`）。

视图（planned）：
- `public fun get_stake(addr: address): u64` — 返回当前质押仓位
- `public fun get_storage_fee(addr: address): u64` — 返回当前存储费率

权限与错误码（示例，占位）：
- 仅 `warehouse` 角色可调用：依赖 `registry::assert_role(..., registry::role_warehouse())`
- `E_INSUFFICIENT_STAKE: u64 = 1`，`E_INVALID_FEE: u64 = 2`（具体值与常量按模块统一约定）
- `fee_per_unit` 限制（如 0 ≤ fee ≤ 10_000，bps）

测试覆盖（示例用例）：
- stake/unstake 正常路径（余额足够、数值累加/扣减正确、事件载荷匹配）
- 边界（0 值、超上限、超下限）→ 触发错误码
- 仅仓库地址可 set_storage_fee；其他角色调用失败

## 15. BFF 监听/服务骨架（最小实现片段）

GraphQL 查询（与 Accounts 类似，按多类型 _in）：
```graphql
query StakingEvents(
  $eventTypes: [String!]
  $limit: Int!
  $cursorVersion: bigint!
  $cursorEventIndex: bigint!
) {
  events(
    where: {
      type: { _in: $eventTypes }
      _or: [
        { transaction_version: { _gt: $cursorVersion } }
        { transaction_version: { _eq: $cursorVersion }, event_index: { _gt: $cursorEventIndex } }
      ]
    }
    order_by: [{ transaction_version: asc }, { event_index: asc }]
    limit: $limit
  ) {
    transaction_version
    event_index
    type
    data
    account_address
  }
}
```

监听器伪代码：
```ts
// apps/bff/src/modules/staking/staking.listener.ts
@Injectable()
export class StakingListener implements OnModuleInit, OnModuleDestroy {
  private lastVersion = -1n; private lastIndex = -1n;
  constructor(private cfg: ConfigService, private repo: StakingRepository, private http: HttpService) {}
  async onModuleInit() {
    const cursor = await this.repo.getLatestCursor(); // 从两表取 max(version,index)
    if (cursor) { this.lastVersion = cursor.version; this.lastIndex = cursor.index; }
    this.start();
  }
  private async pollOnce() {
    const events = await this.fetchEvents(this.lastVersion, this.lastIndex);
    for (const e of events) {
      const mapped = this.map(e);
      if (mapped.kind === 'stake') await this.repo.upsertStake(mapped);
      else await this.repo.upsertFee(mapped);
      this.lastVersion = BigInt(e.transaction_version);
      this.lastIndex = BigInt(e.event_index);
    }
  }
}
```

Repository 接口（示例）：
```ts
// apps/bff/src/modules/staking/staking.repository.ts
export interface StakeUpsertInput { warehouseAddress: string; stakedAmount: bigint; txnVersion: bigint; eventIndex: bigint; }
export interface FeeUpsertInput { warehouseAddress: string; feePerUnit: number; txnVersion: bigint; eventIndex: bigint; }
export class StakingRepository {
  constructor(private prisma: PrismaService) {}
  async getLatestCursor(): Promise<{ version: bigint; index: bigint } | null> { /* select max from both tables */ }
  async upsertStake(i: StakeUpsertInput) { /* prisma.stakingPosition.upsert */ }
  async upsertFee(i: FeeUpsertInput) { /* prisma.storageFeeCache.upsert */ }
}
```

Controller 响应 DTO（Intent）：
```ts
// apps/bff/src/modules/staking/staking.controller.ts
export interface StakingIntentDto {
  warehouseAddress: string;
  stakedAmount: string; // stringified subunits (BigInt)
  minRequired: string;  // 可先置 0，后续按业务策略计算
  feePerUnit: number;   // bps / minimal unit
}
```

Metrics（以 Prometheus 命名）：
- `staking_listener_last_version`（gauge）labels: `{ listener: 'staking' }`
- `staking_listener_error_total`（counter）labels: `{ listener: 'staking', stage: 'fetch|process|persist' }`

## 16. 前端 API & Hook 骨架（最小实现片段）
API 封装（与 registration/orders 风格一致）：
```ts
// apps/web/lib/api/staking.ts
type ApiEnvelope<T> = { data: T; meta?: { requestId?: string; source?: 'onchain'|'cache' } };
export interface StakingIntentDto { warehouseAddress: string; stakedAmount: string; minRequired: string; feePerUnit: number }
const buildUrl = (p: string) => (process.env.NEXT_PUBLIC_BFF_URL || '').replace(/\/$/, '') + p;
export async function fetchStakingIntent(addr: string): Promise<StakingIntentDto> {
  const res = await fetch(buildUrl(`/api/staking/${addr}`), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Failed to load staking intent');
  const body = (await res.json()) as ApiEnvelope<StakingIntentDto> | StakingIntentDto;
  return 'data' in body ? body.data : body;
}
```

Hook（React Query 示例）：
```ts
// apps/web/features/staking/hooks/useStakingIntent.ts
import { useQuery } from '@tanstack/react-query';
import { fetchStakingIntent } from '@/lib/api/staking';
export function useStakingIntent(address?: string) {
  return useQuery({
    queryKey: ['staking-intent', address],
    queryFn: () => fetchStakingIntent(address!),
    enabled: !!address
  });
}
```

UI 占位（卡片）：
```tsx
// apps/web/features/staking/StakingDashboard.tsx
export function StakingDashboard({ address }: { address: string }) {
  const { data, isLoading, error, refetch } = useStakingIntent(address);
  if (isLoading) return <div>Loading staking…</div>;
  if (error || !data) return <div>Failed to load staking</div>;
  return (
    <section>
      <h2>Warehouse Staking</h2>
      <dl>
        <dt>Staked Amount</dt><dd>{Number(data.stakedAmount).toLocaleString()}</dd>
        <dt>Storage Fee</dt><dd>{data.feePerUnit} bps</dd>
      </dl>
      {/* Buttons stake/unstake/set fee to be wired to wallet */}
      <button onClick={() => refetch()}>Refresh</button>
    </section>
  );
}
```

### 16.1 前端组件（ShadCN MCP）
- 使用 ShadCN 组件库，通过 MCP 获取并安装组件，统一样式与交互。
- 建议组件：`@shadcn/button`、`@shadcn/card`、`@shadcn/input`、`@shadcn/label`、`@shadcn/select`、`@shadcn/badge`、`@shadcn/alert`、`@shadcn/toast`、`@shadcn/skeleton`。
- MCP 工作流：
  - 若缺少 `components.json`，先初始化 ShadCN；
  - 使用 `shadcn__get_add_command_for_items` 获取 add 命令并在 `apps/web` 执行；
  - 可用 `shadcn__get_item_examples_from_registries` 查看示例并对照实现。

无障碍与错误处理：
- 在按钮上添加 aria-label，状态变更通过 `aria-live=polite` 公告。
- 将 `meta.source==='cache'` 时在 UI 标注“数据来自缓存”。

## 17. 迁移与运行命令（可复制）
数据库迁移：
```bash
export DATABASE_URL="postgres://haigo:haigo@localhost:5433/haigo"
pnpm --filter @haigo/bff prisma generate
pnpm --filter @haigo/bff prisma migrate dev -n add_staking_tables
pnpm --filter @haigo/bff prisma:migrate:deploy
```

服务运行：
```bash
pnpm --filter @haigo/shared build
pnpm --filter @haigo/bff build && pnpm --filter @haigo/bff start
pnpm --filter @haigo/web dev
```

## 18. 环境变量一览（默认与建议）
- Aptos 网关：`APTOS_INDEXER_URL`、`APTOS_NODE_API_URL`、可选 `APTOS_NODE_API_KEY`
- 模块地址：`NEXT_PUBLIC_APTOS_MODULE=0x<发布地址>`
- 监听参数（Staking）：
  - `STAKING_INGESTOR_INTERVAL_MS=30000`
  - `STAKING_INGESTOR_PAGE_SIZE=25`
  - `STAKING_INGESTOR_MAX_PAGES_PER_TICK=1`
  - `STAKING_INGESTOR_START_FROM_LATEST=true`
  - `STAKING_INGESTOR_BACKFILL_OFFSET_VERSIONS=0`

## 19. 监控与补偿细节
- 指标埋点：在 poll 成功后更新 `staking_listener_last_version`，异常路径计数 `staking_listener_error_total{stage}`。
- 退避策略：沿用 Accounts 的 408/429 cooldown（指数退避+抖动），日志打印下次唤醒时间。
- 游标恢复：启动时从两缓存表读取 max(version/index) 作为起点；若为空且 `START_FROM_LATEST=true`，从最新账本-回填偏移启动。
- Fullnode 兜底：当 Indexer 无 txn hash/timestamp 时，调用 `/v1/transactions/by_version/:version` 填充；失败则以合成值写库并打警告。

## 20. 验收用例（Given-When-Then）
- Given 仓库地址 A 未质押，When 钱包签名 stake(1_000_000) 成功，Then ≤30s 内 GET /api/staking/intent 返回 `stakedAmount >= 1_000_000`。
- Given A 已设置费率 25bps，When set_storage_fee(30) 成功，Then ≤30s 内返回 `feePerUnit=30` 且 meta.source 可为 onchain/cache。
- Given Indexer 速率受限，When 触发 429，Then 指标 `staking_listener_error_total{stage='fetch'}` 增加且日志出现 cooldown，恢复后继续推进游标。

## 21. 推出/回滚策略
- Feature Flag：`ENABLE_STAKING_MODULE`（BFF 启动时控制注册路由与监听器）。
- 回滚：关闭监听与路由；保留缓存表数据；FE 卡片读取 intent 时显示只读状态。

## 22. 任务拆解与先后顺序（建议）
1) Shared DTO（staking.ts）+ BFF Prisma 迁移（并发独立）
2) BFF Listener/Repository 最小可用 + Controller GET /intent
3) FE API/Hook + 仓主页面卡片占位（只读）
4) Move 合约增量（测试网）+ FE 钱包按钮接线
5) 指标埋点/回扫补偿 + 文档锚点更新

## 23. cURL 自检片段
```bash
curl -s "$NEXT_PUBLIC_BFF_URL/api/staking/0x<warehouse>" | jq
```

## 24. 提交与 CI
- PR 需附带：迁移 SQL、BFF 单元测试（listener mapping、repo upsert）、FE 组件快照 + Hook 测试（可选）。
- CI 检查：`pnpm --filter @haigo/bff lint && pnpm --filter @haigo/bff test` 必须通过；`@haigo/shared build` 产物同步。
