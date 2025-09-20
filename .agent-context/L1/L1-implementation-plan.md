# L1 — 家庭仓 Listing 选择（Directory）实施计划（Design → Steps → Tests）

> 本工作项（L1）目标：为商家提供“家庭仓（仓库）目录 Listing 选择”能力，支持按可用性/费率/信用/地域等维度筛选与排序，输出统一的仓库摘要卡片供下单前选择。该能力不涉及链上交易，聚焦 BFF 聚合与前端体验。
>
> 详细数据流（含时序图、筛选与排序、缓存）见：`.agent-context/L1/data-stream.md`

场景表定位：docs/architecture/10-场景化端到端数据流.md:10.5（商家浏览家庭仓 Listing）

## 0. 上下文与需阅读文档
- 场景数据流：docs/architecture/10-场景化端到端数据流.md（10.1 总览、10.5 L1、10.6 O1）
- 链下服务：docs/architecture/4-链下服务与数据流.md（模块索引、4.9 W1 与后续 L1 消费）
- 前端：docs/front-end-spec.md（Dashboard ASCII；Seller 查看 Listing 的入口与 CTA；Create Order UI/UX）
- 共享类型：packages/shared/src/dto/orders.ts（WarehouseSummary/Availability）、packages/shared/src/config/orders.ts（常量）

## 一、范围与新增功能/模块
- BFF（apps/bff）
  - 新增 `DirectoryModule`：对外暴露 `/api/warehouses` 列表查询，支持筛选/排序/分页；聚合仓库注册信息、质押与费率、媒体样本与评分。数据源优先直接读取 W1 产出的 Prisma 表（`staking_positions` 与 `storage_fees_cache`），避免依赖 Hasura 的临时视图。
  - 新增 `DirectoryRepository`：基于 Prisma/Hasura 聚合数据，并提供轻量内存缓存（TTL）。
  - 新增（可选）`HasuraClient`：封装 Hasura GraphQL 查询，补充信用画像与服务区域数据。
- FE（apps/web）
  - 新增 Seller 目录页：`app/(seller)/warehouses/page.tsx`（或别名 `/directory`），展示筛选器与仓库卡片；卡片 CTA 跳转下单页 `/(merchant)/orders/new?warehouse=0x...`（对齐 O1）。
  - 新增目录 Hook：`features/directory/useWarehouseDirectory.ts` 管理筛选、分页、加载状态。
  - 新增展示组件：`features/directory/WarehouseCard.tsx`；必要时抽象 `WarehouseFilters`。
  - UI 组件（ShadCN MCP）：通过 MCP 获取并安装 `card`、`button`、`input`、`select`、`badge`、`alert`、`toast`、`skeleton`、`pagination` 等组件，统一样式。
- Shared/DTO
  - 复用 `packages/shared/src/dto/orders.ts` 的 `WarehouseSummary`、`WarehouseAvailability`；若需要在 Listing 显示/过滤存储费，建议在 `WarehouseSummary` 增加可选字段 `feePerUnit?: number`（万分比），供 L1 展示与筛选，O1 不强制依赖。

非目标（本 L1 不包含）
- 质押/费率链上设置（属于 W1）。
- 订单草稿与签署（O1）。
- 订单收件箱（W2）。

## 二、设计细节（核心 Anchors）

### 2.1 BFF Directory 模块
文件：`apps/bff/src/modules/directory/directory.module.ts`
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { DirectoryController } from './directory.controller.js';
import { DirectoryService } from './directory.service.js';
import { DirectoryRepository } from './directory.repository.js';
import { HasuraClient } from '../hasura/hasura.client.js';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [DirectoryController],
  providers: [DirectoryRepository, DirectoryService, HasuraClient],
  exports: [DirectoryService]
})
export class DirectoryModule {}
```

文件：`apps/bff/src/modules/directory/directory.controller.ts`（返回数组以兼容现有 FE fetchWarehouses）
```ts
import { Controller, Get, Query } from '@nestjs/common';
import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import { DirectoryService } from './directory.service.js';

interface ListQuery {
  available?: string;
  minScore?: string;
  maxFeeBps?: string;
  area?: string;
  q?: string;
  sort?: 'score_desc' | 'fee_asc' | 'capacity_desc' | 'recent';
  page?: string;
  pageSize?: string;
}

@Controller('/api/warehouses')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  async list(@Query() q: ListQuery): Promise<WarehouseSummary[] | { data: WarehouseSummary[] }> {
    const page = Math.max(parseInt(q.page || '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(q.pageSize || '20', 10) || 20, 1), 100);

    const result = await this.directory.list({
      available: q.available === 'true',
      minScore: Number.isFinite(Number(q.minScore)) ? Number(q.minScore) : undefined,
      maxFeeBps: Number.isFinite(Number(q.maxFeeBps)) ? Number(q.maxFeeBps) : undefined,
      area: q.area?.trim() || undefined,
      q: q.q?.trim() || undefined,
      sort: (q.sort as any) || 'score_desc',
      page,
      pageSize
    });

    // 兼容策略：返回数组（或 { data }），以匹配 apps/web/lib/api/orders.ts 的 fetchWarehouses()
    return result.items; // 或：return { data: result.items };
  }
}
```

文件：`apps/bff/src/modules/directory/directory.service.ts`
```ts
import { Injectable } from '@nestjs/common';
import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import { DirectoryRepository } from './directory.repository.js';

type DirectorySort = 'score_desc' | 'fee_asc' | 'capacity_desc' | 'recent';

@Injectable()
export class DirectoryService {
  constructor(private readonly repo: DirectoryRepository) {}

  list(input: {
    available?: boolean;
    minScore?: number;
    maxFeeBps?: number;
    area?: string;
    q?: string;
    sort: DirectorySort;
    page: number;
    pageSize: number;
  }): Promise<{ items: WarehouseSummary[]; page: number; pageSize: number; total?: number }> {
    return this.repo.listWarehouses(input);
  }
}
```

文件：`apps/bff/src/modules/directory/directory.repository.ts`
```ts
import { Injectable, Logger } from '@nestjs/common';
import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { HasuraClient } from '../hasura/hasura.client.js';

const TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  key: string;
  value: { items: WarehouseSummary[]; total?: number };
}

@Injectable()
export class DirectoryRepository {
  private readonly logger = new Logger(DirectoryRepository.name);
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasura: HasuraClient
  ) {}

  async listWarehouses(input: {
    available?: boolean;
    minScore?: number;
    maxFeeBps?: number;
    area?: string;
    q?: string;
    sort: 'score_desc' | 'fee_asc' | 'capacity_desc' | 'recent';
    page: number;
    pageSize: number;
  }): Promise<{ items: WarehouseSummary[]; page: number; pageSize: number; total?: number }> {
    const key = JSON.stringify(input);
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < TTL_MS) {
      return { ...hit.value, page: input.page, pageSize: input.pageSize };
    }

    const baseWhere: any = { role: 'warehouse' };
    // available 由业务规则或快照推导，当前 schema 无 isAvailable 字段，保持占位注释

    const accounts = await this.prisma.account.findMany({
      where: baseWhere,
      take: input.pageSize,
      skip: (input.page - 1) * input.pageSize,
      orderBy: { createdAt: 'desc' }
    });

    const total = await this.prisma.account.count({ where: baseWhere });

    const addresses = accounts.map((a) => a.accountAddress.toLowerCase());

    const [positions, fees, hasuraMap] = await Promise.all([
      this.prisma.stakingPosition.findMany({ where: { warehouseAddress: { in: addresses } } }),
      this.prisma.storageFeeCache.findMany({ where: { warehouseAddress: { in: addresses } } }),
      this.hasura.fetchStakingSnapshot(addresses).catch((err) => {
        this.logger.warn({ err }, 'Hasura snapshot failed, falling back');
        return new Map<string, any>();
      })
    ]);

    const posMap = new Map(positions.map((p) => [p.warehouseAddress.toLowerCase(), p]));
    const feeMap = new Map(fees.map((f) => [f.warehouseAddress.toLowerCase(), f]));

    const mediaByAddress = new Map<string, string[]>();
    // 预留：加载最近媒体样本，可通过文件服务或 Prisma 表

    const items = accounts
      .map((account) => {
        const addr = account.accountAddress.toLowerCase();
        const position = posMap.get(addr);
        const fee = feeMap.get(addr);
        const hasuraRow = hasuraMap.get(addr);
        const creditCapacity = Number(position?.stakedAmount ?? 0n);
        const feePerUnit = Number(fee?.feePerUnit ?? hasuraRow?.fee_per_unit ?? 0);
        const coverageAreas = hasuraRow?.areas ?? [];
        const createdAt = account.createdAt instanceof Date ? account.createdAt.getTime() : Date.now();

        return {
          id: account.accountAddress,
          address: account.accountAddress,
          name: account.profileUri ?? account.accountAddress.slice(0, 10),
          stakingScore: Math.min(Math.floor(creditCapacity / 100_000_000), 100),
          creditCapacity,
          availability: input.available === false ? 'maintenance' : 'available',
          mediaSamples: mediaByAddress.get(account.accountAddress) ?? [],
          serviceAreas: coverageAreas,
          feePerUnit,
          createdAt
        } as WarehouseSummary & { feePerUnit?: number; serviceAreas?: string[]; createdAt: number };
      })
      .filter((warehouse) => input.maxFeeBps == null || (warehouse as any).feePerUnit == null || (warehouse as any).feePerUnit <= input.maxFeeBps)
      .filter((warehouse) => input.minScore == null || warehouse.stakingScore >= input.minScore)
      .filter((warehouse) => {
        if (!input.q) return true;
        const q = input.q.toLowerCase();
        return (
          warehouse.name?.toLowerCase().includes(q) ||
          warehouse.address.toLowerCase().includes(q) ||
          (warehouse as any).areas?.some((area: string) => area.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        switch (input.sort) {
          case 'fee_asc':
            return ((a as any).feePerUnit ?? Number.MAX_SAFE_INTEGER) - ((b as any).feePerUnit ?? Number.MAX_SAFE_INTEGER);
          case 'capacity_desc':
            return (b.creditCapacity ?? 0) - (a.creditCapacity ?? 0);
          case 'recent':
            return (b as any).createdAt - (a as any).createdAt;
          default:
            return (b.stakingScore ?? 0) - (a.stakingScore ?? 0);
        }
      });

    const value = { items, total };
    this.cache.set(key, { at: now, key, value });

    return { ...value, page: input.page, pageSize: input.pageSize };
  }
}
```

### 2.2 Hasura Client（可选增强）
文件：`apps/bff/src/modules/hasura/hasura.client.ts`
```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HasuraClient {
  private readonly url: string;
  private readonly adminSecret: string;

  constructor(cfg: ConfigService) {
    this.url = cfg.get<string>('hasuraUrl', 'http://localhost:8080/v1/graphql');
    this.adminSecret = cfg.get<string>('hasuraAdminSecret', '');
  }

  async fetchStakingSnapshot(addresses: string[]): Promise<Map<string, any>> {
    if (!addresses.length) return new Map();

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.adminSecret) headers['x-hasura-admin-secret'] = this.adminSecret;

    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `
          query DirectorySnapshot($addrs: [String!]) {
            staking_snapshot(where: { address: { _in: $addrs } }) {
              address
              score
              capacity
              areas
              fee_per_unit
              last_audit_at
            }
          }`,
        variables: { addrs: addresses }
      })
    });

    if (!res.ok) return new Map();

    const json = (await res.json()) as any;
    const rows = (json?.data?.staking_snapshot ?? []) as any[];

    return new Map(rows.map((row) => [String(row.address).toLowerCase(), row]));
  }
}
```

### 2.3 FE Hook：`useWarehouseDirectory`
文件：`apps/web/features/directory/useWarehouseDirectory.ts`
```ts
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WarehouseSummary } from '@haigo/shared/dto/orders';

type Filters = {
  available?: boolean;
  minScore?: number;
  maxFeeBps?: number;
  area?: string;
  q?: string;
  sort?: string;
};

export function useWarehouseDirectory(initial?: Partial<{ page: number; pageSize: number; filters: Filters }>) {
  const [items, setItems] = useState<WarehouseSummary[]>([]);
  const [page, setPage] = useState(initial?.page ?? 1);
  const [pageSize, setPageSize] = useState(initial?.pageSize ?? 20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(initial?.filters ?? { sort: 'score_desc' });
  const [total, setTotal] = useState<number | undefined>();

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.available) params.set('available', 'true');
    if (typeof filters.minScore === 'number') params.set('minScore', String(filters.minScore));
    if (typeof filters.maxFeeBps === 'number') params.set('maxFeeBps', String(filters.maxFeeBps));
    if (filters.area) params.set('area', filters.area);
    if (filters.q) params.set('q', filters.q);
    if (filters.sort) params.set('sort', filters.sort);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return params.toString();
  }, [filters, page, pageSize]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouses?${query}`);
      if (!res.ok) throw new Error(`Directory failed: ${res.status}`);
      const json: any = await res.json();
      const items = Array.isArray(json)
        ? json
        : Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.items)
            ? json.items
            : [];
      setItems(items);
      setTotal(typeof json?.total === 'number' ? json.total : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    items,
    total,
    page,
    pageSize,
    setPage,
    setPageSize,
    filters,
    setFilters,
    loading,
    error,
    refresh
  };
}
```

### 2.4 Listing 页面与组件
- 文件：`apps/web/features/directory/WarehouseCard.tsx`
```tsx
'use client';
import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import Link from 'next/link';

interface Props { warehouse: WarehouseSummary & { feePerUnit?: number; serviceAreas?: string[] } }

export function WarehouseCard({ warehouse }: Props) {
  return (
    <article className="rounded-lg border bg-background p-4 shadow-sm">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{warehouse.name ?? warehouse.address}</h2>
        <span className="text-sm text-muted-foreground">{warehouse.address}</span>
      </header>

      <dl className="grid gap-1 text-sm text-muted-foreground">
        <div><dt className="inline font-medium text-foreground">评分：</dt><dd className="inline">{warehouse.stakingScore ?? '-'}</dd></div>
        <div><dt className="inline font-medium text-foreground">信用额度：</dt><dd className="inline">{warehouse.creditCapacity ?? 0}</dd></div>
        <div><dt className="inline font-medium text-foreground">存储费：</dt><dd className="inline">{warehouse.feePerUnit != null ? `${warehouse.feePerUnit} bps` : '未配置'}</dd></div>
        <div><dt className="inline font-medium text-foreground">覆盖区域：</dt><dd className="inline">{warehouse.serviceAreas?.join('、') ?? '—'}</dd></div>
      </dl>

      <footer className="mt-3 flex justify-end">
        <Link className="btn btn-primary btn-sm" href={`/(merchant)/orders/new?warehouse=${warehouse.address}`}>
          选择仓库
        </Link>
      </footer>
    </article>
  );
}
```

- 文件：`apps/web/app/(seller)/warehouses/page.tsx`
```tsx
'use client';
import { WarehouseCard } from '@/features/directory/WarehouseCard';
import { useWarehouseDirectory } from '@/features/directory/useWarehouseDirectory';

export default function WarehousesPage() {
  const directory = useWarehouseDirectory();

  return (
    <main className="container mx-auto flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">选择家庭仓</h1>
        <p className="text-muted-foreground">使用筛选器根据费率、评分与区域快速定位合适的仓库。</p>
      </header>

      {/* TODO: WarehouseFilters 组件（使用 directory.setFilters） */}

      {directory.error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          加载失败：{directory.error}
        </div>
      ) : null}

      {directory.loading ? (
        <div className="rounded border p-6 text-center text-muted-foreground">正在加载仓库列表…</div>
      ) : directory.items.length === 0 ? (
        <div className="rounded border border-dashed p-6 text-center text-muted-foreground">暂无符合条件的家庭仓。</div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {directory.items.map((warehouse) => (
            <WarehouseCard key={warehouse.id} warehouse={warehouse as any} />
          ))}
        </section>
      )}

      {/* TODO: Pagination 控件（基于 directory.page, directory.total） */}
    </main>
  );
}
```

#### 2.4.1 ShadCN（MCP 集成）
- 组件清单：Card、Button、Input、Select、Badge、Alert、Toast、Skeleton、Pagination；
- MCP：使用 `shadcn__get_add_command_for_items` 获取安装命令；若需示例，调用 `shadcn__get_item_examples_from_registries`；
- 约定：在 `apps/web` 根执行 add 命令，保持 components.json 与样式引入一致；
- 验收：筛选器与卡片渲染一致，空态/加载态/错误态通过 Skeleton/Alert/Toast 呈现。

- Seller Dashboard 入口：`apps/web/features/dashboard/SellerDashboard.tsx` 中新增「Find Warehouses」卡片，跳转至 `/warehouses`。

### 2.5 与 O1/W1 的数据联动
- O1：CreateOrder 向导在初始化时读取 `?warehouse=` 参数，作为默认选中的仓库地址。
- W1：Listener 更新 `staking_positions` 与 `storage_fees_cache`，L1 直接消费最新快照。
- 媒体服务：若存在媒体 API，则在 `DirectoryRepository` 中追加获取媒体示例的调用；无媒体验证时保持空数组。

## 三、跨模块协同
- 依赖 R1：仅展示 `accounts.role = 'warehouse'` 的账号。
- 依赖 W1：质押/费率/容量源自 W1 挂载的缓存表；接口需处理空值。
- 依赖 Media：可选读取最近媒体样本，失败不影响列表。
- 与 O1：Listing 选择完成后，通过 CTA 参数把仓库地址传递给 O1 下单流程；O1 可复用同一 DirectoryService 以保持数据一致。

## 四、注意事项（实现与运维）
- 性能：缓存结果 TTL 30s；分页与筛选需利用 `account` 表索引。必要时追加 `staking_positions.warehouse_address` 复合索引。
- 可用性：Hasura 不可用时 fallback 到 Prisma 数据；记录 warn 日志避免噪音。
- 安全：不暴露敏感字段，仅返回摘要（隐藏联系人、内部 ID 等）。
- 可观测性：利用 Nest logger/metrics 记录查询耗时、缓存命中率、外部依赖错误；未来可接入 OpenTelemetry。
- 速率限制：当前暂不实现，可在 API Gateway 或 Nest Guard 中扩展。

## 五、需同步更新的文档
- `docs/architecture/10-场景化端到端数据流.md`: L1 状态标记为“已实现”，补齐 DirectoryModule 与 FE Anchor 路径。
- `docs/architecture/4-链下服务与数据流.md`: 新增 Directory 小节，描述模块结构、缓存策略、Hasura 集成。
- `docs/architecture/5-前端体验.md`: 在 5.5 场景 Anchor 中增加 `useWarehouseDirectory.ts`、`/(seller)/warehouses/page.tsx`、`WarehouseCard.tsx`。
- `docs/architecture/6-部署与环境.md`: 补充 `HASURA_URL`、`HASURA_ADMIN_SECRET` 等新环境变量。

## 六、测试计划
- **BFF 单元测试（apps/bff/test）**
  - `directory.repository.spec.ts`: 缓存命中/过期；Hasura 失败回退；筛选与排序逻辑。
  - `directory.controller.spec.ts`: 查询参数解析、默认分页、响应结构。
- **BFF 集成测试**
  - 使用 Prisma 测试数据库 + Mock Hasura，验证分页/排序结果、fallback 行为。
- **前端测试（apps/web）**
  - `useWarehouseDirectory.test.tsx`: 模拟成功/失败/空列表；验证参数串拼接。
  - UI 组件快照与交互测试：WarehouseCard 渲染、Filters 控件调用 `setFilters`。
- **端到端（可选）**
  - Playwright 测试 Seller 从 Dashboard 进入目录、筛选、跳转下单页。

## 七、验收标准
- `/api/warehouses` 支持筛选、排序、分页，Hasura 故障时仍返回最小数据。
- Seller Dashboard 出现「Find Warehouses」入口，且可进入目录页。
- 目录页展示完整卡片信息，CTA 正确传递仓库地址。
- 单元/集成/前端测试通过；文档回填完成，Anchor 一致。
- 关键查询在预期数据量下响应时间 < 1s（PoC 环境）。

## 八、实施步骤（Checklist）
1. BFF：落地 DirectoryModule、Controller、Service、Repository、HasuraClient 骨架与缓存逻辑。
2. Shared DTO：确认 `WarehouseSummary` 是否需要扩展字段（如 `feePerUnit`、`areas`），并在共享包中更新。
3. FE：实现 `useWarehouseDirectory` Hook、`WarehouseCard` 组件、`/(seller)/warehouses` 页面。
4. Dashboard：新增入口按钮/卡片指向目录页，验证导航路径。
5. 测试：补充单元与集成测试、前端 Hook/组件测试；必要时添加 Playwright 脚本。
6. 可观测：新增日志/metrics，配置 Hasura URL 与密钥 ENV。
7. 文档：按“五、需同步更新的文档”列表回填架构文档。
8. 自验：通过本地端到端串联（W1→L1→O1）确认数据连通性。

完成定义（DoD）
- 代码合并 + 新增测试通过 + 文档回填。
- 目录响应稳定且具备基础可观测性。
- Dashboard → Listing → 下单向导链路完成走查。

## 九、参考文档（必读）
- `docs/architecture/index.md:1`
- `docs/front-end-spec.md:1`
- `.agent-context/L1/data-stream.md`
