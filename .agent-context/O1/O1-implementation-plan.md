# O1 订单创建与链上签署 — 完整实现计划（Design → Steps → Tests）

> 依据 docs/architecture/10-场景化端到端数据流.md:10.4 与 docs/architecture/2-系统分层概览.md，落地“商家创建订单并链上签署”，覆盖 FE/BFF/DB/Indexer/Fullnode 兜底的端到端实现与验收。
>
> 场景表定位：| O1 | 订单创建与链上签署 | 商家 | orders | 🚧 规划中 |

## 一、目标与交付物
- FE 创建订单向导：选择仓库 → 费用配置 → 复核签名（含 Gas 估算）。
- BFF 订单草稿 API + 订单查询 API；事件监听回写链上创建结果；Fullnode 事务兜底。
- DB Prisma 模型：orders / order_events 与既有 media_assets 通过 record_uid 关联。
- Indexer 事件消费：OrderCreated → 写入订单、时间线事件、补齐 txn_hash/timestamp。
- 覆盖单元/集成/端到端测试与验收清单；文档 Anchor 回填。

## 二、跨层设计（契约与流程）
- FE 直连钱包签名 create_order（保留“BFF 生成签名载荷”扩展位）；提交后轮询 BFF 获取订单详情与列表。
- BFF 按 10.4 时序：
  - POST /api/orders/drafts → 保存草稿（status=ORDER_DRAFT），返回 recordUid 与推荐签名参数（function、typeArgs、args）。
  - 监听 Indexer: OrderCreated 事件 → 通过 Fullnode by_version 兜底 txn_hash + timestamp → 更新 orders（status=ONCHAIN_CREATED）。
  - GET /api/orders/:recordUid → 返回链上+链下汇总状态（含时间线）。
  - GET /api/orders → 返回当前账户订单摘要列表（按 created_at desc）。
- Move haigo::orders 已具备 create_order 与 OrderCreated 事件，无需改动（move/sources/orders.move）。

- 环境变量与配置（对齐 docs/architecture/6-部署与环境.md）
  - 监听间隔与分页：新增并优先读取 `ORDER_INGESTOR_INTERVAL_MS`、`ORDER_INGESTOR_PAGE_SIZE`（若未设置则回退到通用的 `ingestion.pollingIntervalMs`/`ingestion.pageSize`）。
  - Fullnode API Key：若存在 `APTOS_NODE_API_KEY`，Fullnode 请求同时发送 `x-aptos-api-key: <key>` 与 `Authorization: Bearer <key>` 以兼容不同网关。
  - 统一从仓库根 `.env.local` 读取 `APTOS_INDEXER_URL`、`APTOS_NODE_API_URL` 等端点。

## 三、Anchor 实现清单与代码骨架

### 1) Prisma 模型与迁移（apps/bff/prisma/schema.prisma）
```prisma
// --- O1 新增 ---
enum OrderStatus {
  ORDER_DRAFT
  ONCHAIN_CREATED
  WAREHOUSE_IN
  IN_STORAGE
  WAREHOUSE_OUT
}

model Order {
  id               BigInt      @id @default(autoincrement())
  recordUid        String      @unique @map("record_uid")
  creatorAddress   String      @map("creator_address")
  warehouseAddress String      @map("warehouse_address")
  status           OrderStatus
  orderId          Int?        @map("order_id")
  payloadJson      Json?       @map("payload_json")
  txnVersion       BigInt?     @map("txn_version")
  eventIndex       BigInt?     @map("event_index")
  txnHash          String?     @map("txn_hash")
  chainTimestamp   DateTime?   @map("chain_timestamp")
  createdAt        DateTime    @default(now()) @map("created_at")
  updatedAt        DateTime    @updatedAt @map("updated_at")

  @@index([creatorAddress], map: "orders_creator_idx")
  @@index([warehouseAddress], map: "orders_warehouse_idx")
  @@map("orders")
}

model OrderEvent {
  id             BigInt    @id @default(autoincrement())
  recordUid      String    @map("record_uid")
  orderId        Int?      @map("order_id")
  type           String
  txnVersion     BigInt    @map("txn_version")
  eventIndex     BigInt    @map("event_index")
  txnHash        String?   @map("txn_hash")
  chainTimestamp DateTime? @map("chain_timestamp")
  data           Json?     @map("data")
  createdAt      DateTime  @default(now()) @map("created_at")

  @@unique([txnVersion, eventIndex], map: "order_events_cursor_uniq")
  @@index([recordUid], map: "order_events_record_uid_idx")
  @@map("order_events")
}
```

### 2) BFF Orders 模块骨架（apps/bff/src/modules/orders/*）

文件：apps/bff/src/modules/orders/orders.module.ts
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersEventListener } from './orders-event-listener.service.js';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [OrdersController],
  providers: [OrdersRepository, OrdersService, OrdersEventListener],
  exports: [OrdersService]
})
export class OrdersModule {}
```

文件：apps/bff/src/modules/orders/dto/create-order-draft.dto.ts
```ts
export class CreateOrderDraftDto {
  sellerAddress!: string; // FE 可从钱包地址填充
  warehouseAddress!: string;
  inboundLogistics?: string | null;
  pricing!: {
    amountSubunits: number;
    insuranceFeeSubunits: number;
    platformFeeSubunits: number;
    currency: 'APT';
  };
  initialMedia?: { category: string; hashValue: string } | null;
}

export interface OrderDraftResponse {
  recordUid: string;
  // 供 FE 双重校验/或直接使用的钱包签名参数（可选）
  signPayload: {
    function: `${string}::${string}::${string}`;
    typeArguments: string[];
    functionArguments: any[];
  };
}
```

文件：apps/bff/src/modules/orders/orders.controller.ts
```ts
import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import { OrdersService } from './orders.service.js';
import { CreateOrderDraftDto, type OrderDraftResponse } from './dto/create-order-draft.dto.js';

@Controller('/api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('drafts')
  async createDraft(@Body() dto: CreateOrderDraftDto): Promise<OrderDraftResponse> {
    return this.orders.createDraft(dto);
  }

  @Get()
  async list(@Query('seller') seller?: string): Promise<OrderSummaryDto[]> {
    return this.orders.listSummaries({ sellerAddress: seller });
  }

  @Get(':recordUid')
  async detail(@Param('recordUid') recordUid: string): Promise<OrderDetailDto> {
    const detail = await this.orders.getDetail(recordUid);
    if (!detail) throw new NotFoundException('Order not found');
    return detail;
  }
}
```

文件：apps/bff/src/modules/orders/orders.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ORDERS_MODULE_ADDRESS, ORDERS_MODULE_NAME, APTOS_COIN_TYPE } from '@haigo/shared/config/aptos';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import { OrdersRepository } from './orders.repository.js';
import type { CreateOrderDraftDto, OrderDraftResponse } from './dto/create-order-draft.dto.js';

@Injectable()
export class OrdersService {
  constructor(private readonly repo: OrdersRepository) {}

  async createDraft(dto: CreateOrderDraftDto): Promise<OrderDraftResponse> {
    const recordUid = await this.repo.createDraft(dto);
    // 生成推荐签名载荷（FE 亦可自行构建）
    return {
      recordUid,
      signPayload: {
        function: `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::create_order`,
        typeArguments: [APTOS_COIN_TYPE],
        functionArguments: [
          dto.warehouseAddress,
          dto.inboundLogistics ?? null,
          String(dto.pricing.amountSubunits),
          String(dto.pricing.insuranceFeeSubunits),
          String(dto.pricing.platformFeeSubunits),
          dto.initialMedia?.category ?? null,
          dto.initialMedia?.hashValue ? Array.from(Buffer.from(dto.initialMedia.hashValue, 'hex')) : null
        ]
      }
    };
  }

  async listSummaries(filter?: { sellerAddress?: string }): Promise<OrderSummaryDto[]> {
    return this.repo.listSummaries(filter);
  }

  async getDetail(recordUid: string): Promise<OrderDetailDto | null> {
    return this.repo.getDetail(recordUid);
  }

  async applyOrderCreatedEvent(evt: {
    txnVersion: bigint;
    eventIndex: bigint;
    txnHash?: string | null;
    chainTimestamp?: Date | null;
    orderId: number;
    seller: string;
    warehouse: string;
    logisticsInbound?: string | null;
    pricing: { amount: number; insuranceFee: number; platformFee: number; total: number };
  }): Promise<void> {
    await this.repo.upsertOnchainCreated(evt);
  }
}
```

文件：apps/bff/src/modules/orders/orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import type { CreateOrderDraftDto } from './dto/create-order-draft.dto.js';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(dto: CreateOrderDraftDto): Promise<string> {
    const now = new Date();
    const recordUid = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.prisma.order.create({
      data: {
        recordUid,
        creatorAddress: dto.sellerAddress.toLowerCase(),
        warehouseAddress: dto.warehouseAddress.toLowerCase(),
        status: 'ORDER_DRAFT' as any,
        payloadJson: {
          inboundLogistics: dto.inboundLogistics ?? null,
          pricing: dto.pricing,
          initialMedia: dto.initialMedia ?? null
        },
        createdAt: now
      }
    });
    return recordUid;
  }

  async upsertOnchainCreated(evt: {
    txnVersion: bigint; eventIndex: bigint; txnHash?: string | null; chainTimestamp?: Date | null;
    orderId: number; seller: string; warehouse: string; logisticsInbound?: string | null;
    pricing: { amount: number; insuranceFee: number; platformFee: number; total: number };
  }): Promise<void> {
    const recordUid = `order-${evt.orderId}${evt.txnHash ? `-${String(evt.txnHash).slice(2, 10)}` : ''}`;
    // 1) 订单主表：若草稿存在则更新，否则创建
    await this.prisma.order.upsert({
      where: { recordUid },
      create: {
        recordUid,
        creatorAddress: evt.seller.toLowerCase(),
        warehouseAddress: evt.warehouse.toLowerCase(),
        status: 'ONCHAIN_CREATED' as any,
        orderId: evt.orderId,
        txnVersion: evt.txnVersion,
        eventIndex: evt.eventIndex,
        txnHash: evt.txnHash ?? null,
        chainTimestamp: evt.chainTimestamp ?? null
      },
      update: {
        status: 'ONCHAIN_CREATED' as any,
        orderId: evt.orderId,
        txnVersion: evt.txnVersion,
        eventIndex: evt.eventIndex,
        txnHash: evt.txnHash ?? null,
        chainTimestamp: evt.chainTimestamp ?? null
      }
    });
    // 2) 事件表追加
    await this.prisma.orderEvent.upsert({
      where: { txnVersion_eventIndex: { txnVersion: evt.txnVersion, eventIndex: evt.eventIndex } as any },
      create: {
        recordUid,
        orderId: evt.orderId,
        type: 'OrderCreated',
        txnVersion: evt.txnVersion,
        eventIndex: evt.eventIndex,
        txnHash: evt.txnHash ?? null,
        chainTimestamp: evt.chainTimestamp ?? null,
        data: {
          pricing: evt.pricing,
          logistics_inbound: evt.logisticsInbound ?? null
        }
      },
      update: { }
    });
  }

  async listSummaries(filter?: { sellerAddress?: string }): Promise<OrderSummaryDto[]> {
    const where = filter?.sellerAddress ? { creatorAddress: filter.sellerAddress.toLowerCase() } : {};
    const items = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }]
    });
    return items.map((o) => ({
      recordUid: o.recordUid,
      orderId: Number(o.orderId ?? 0),
      status: (o.status.replace('ONCHAIN_', '') as any) ?? 'PENDING',
      warehouseAddress: o.warehouseAddress,
      pricing: {
        amountSubunits: Number((o as any).amountSubunits ?? 0),
        insuranceFeeSubunits: Number((o as any).insuranceFeeSubunits ?? 0),
        platformFeeSubunits: Number((o as any).platformFeeSubunits ?? 0),
        totalSubunits: Number((o as any).totalSubunits ?? 0),
        currency: 'APT',
        precision: 100_000_000
      },
      createdAt: (o.createdAt ?? new Date()).toISOString(),
      updatedAt: (o.updatedAt ?? new Date()).toISOString(),
      transactionHash: o.txnHash ?? undefined
    }));
  }

  async getDetail(recordUid: string): Promise<OrderDetailDto | null> {
    const order = await this.prisma.order.findUnique({ where: { recordUid } });
    if (!order) return null;
    const events = await this.prisma.orderEvent.findMany({ where: { recordUid }, orderBy: [{ txnVersion: 'asc' }] });
    const media = await this.prisma.mediaAsset.findMany({ where: { recordUid } });
    return {
      recordUid: order.recordUid,
      orderId: Number(order.orderId ?? 0),
      status: (order.status.replace('ONCHAIN_', '') as any) ?? 'PENDING',
      warehouseAddress: order.warehouseAddress,
      pricing: {
        amountSubunits: Number((order as any).amountSubunits ?? 0),
        insuranceFeeSubunits: Number((order as any).insuranceFeeSubunits ?? 0),
        platformFeeSubunits: Number((order as any).platformFeeSubunits ?? 0),
        totalSubunits: Number((order as any).totalSubunits ?? 0),
        currency: 'APT',
        precision: 100_000_000
      },
      createdAt: (order.createdAt ?? new Date()).toISOString(),
      updatedAt: (order.updatedAt ?? new Date()).toISOString(),
      transactionHash: order.txnHash ?? undefined,
      timeline: events.map((e) => ({
        stage: e.type === 'OrderCreated' ? 'CREATED' : 'NOTE',
        label: e.type,
        occurredAt: (e.chainTimestamp ?? new Date()).toISOString()
      })),
      mediaAssets: media.map((m) => ({
        recordUid: m.recordUid,
        stage: m.stage as any,
        category: m.category,
        hashAlgorithm: m.hashAlgo as any,
        hashValue: m.hashValue,
        mimeType: m.mimeType ?? undefined,
        sizeBytes: m.sizeBytes ?? undefined,
        path: m.publicPath ?? undefined,
        uploadedBy: m.uploadedBy ?? undefined,
        uploadedAt: (m.uploadedAt ?? new Date()).toISOString(),
        matchedOffchain: m.matchedOffchain
      }))
    };
  }
}
```

文件：apps/bff/src/modules/orders/orders-event-listener.service.ts
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service.js';
import { ORDERS_MODULE_ADDRESS, ORDERS_MODULE_NAME } from '@haigo/shared/config/aptos';

interface OrderCreatedRecord {
  transaction_version: string;
  event_index: number;
  type: string;
  data: any;
}

const ORDER_EVENTS_QUERY = /* GraphQL */ `
  query OrderEvents($eventType: String!, $limit: Int!, $cursorVersion: bigint!, $cursorEventIndex: bigint!) {
    events(
      where: {
        type: { _eq: $eventType }
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
    }
  }
`;

@Injectable()
export class OrdersEventListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersEventListener.name);
  private pollHandle: NodeJS.Timeout | null = null;
  private lastTxnVersion = BigInt(-1);
  private lastEventIndex = BigInt(-1);
  private readonly indexerUrl: string;
  private readonly nodeApiUrl: string;
  private readonly aptosApiKey: string;
  private readonly pageSize: number;
  private readonly pollingInterval: number;

  constructor(private readonly config: ConfigService, private readonly orders: OrdersService) {
    this.indexerUrl = this.config.get<string>('indexerUrl', 'https://indexer.testnet.aptoslabs.com/v1/graphql');
    this.nodeApiUrl = this.config.get<string>('nodeApiUrl', 'https://fullnode.testnet.aptoslabs.com/v1');
    this.aptosApiKey = this.config.get<string>('aptosApiKey', '');
    // 优先使用 O1 专用环境变量，其次回落到通用 ingestion.*
    this.pageSize = Number(process.env.ORDER_INGESTOR_PAGE_SIZE ?? this.config.get<number>('ingestion.pageSize', 50));
    this.pollingInterval = Number(
      process.env.ORDER_INGESTOR_INTERVAL_MS ?? this.config.get<number>('ingestion.pollingIntervalMs', 30_000)
    );
  }

  async onModuleInit(): Promise<void> {
    await this.pollOnce();
    this.startPolling();
  }
  async onModuleDestroy(): Promise<void> { this.stopPolling(); }

  private startPolling() {
    if (this.pollHandle) return;
    this.pollHandle = setInterval(() => void this.pollOnce(), this.pollingInterval);
  }
  private stopPolling() { if (this.pollHandle) { clearInterval(this.pollHandle); this.pollHandle = null; } }

  private async pollOnce(): Promise<void> {
    try {
      const eventType = `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::OrderCreated`;
      let hasMore = true;
      while (hasMore) {
        const batch = await this.fetchEvents(eventType);
        if (batch.length === 0) break;
        for (const e of batch) { await this.processEvent(e); }
        hasMore = batch.length === this.pageSize;
      }
    } catch (e) {
      this.logger.error('OrderEvents poll failed', e instanceof Error ? e.stack : e);
    }
  }

  private async fetchEvents(eventType: string): Promise<OrderCreatedRecord[]> {
    const res = await fetch(this.indexerUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: ORDER_EVENTS_QUERY,
        variables: {
          eventType,
          limit: this.pageSize,
          cursorVersion: this.lastTxnVersion.toString(),
          cursorEventIndex: this.lastEventIndex.toString()
        }
      })
    });
    if (!res.ok) { throw new Error(`Indexer returned ${res.status}`); }
    const json = (await res.json()) as { data?: { events: OrderCreatedRecord[] }; errors?: Array<{ message: string }> };
    if (json.errors?.length) throw new Error(json.errors.map((x) => x.message).join('; '));
    return json.data?.events ?? [];
  }

  private async processEvent(evt: OrderCreatedRecord): Promise<void> {
    // Fullnode by_version 兜底 txn_hash/timestamp
    const meta = await this.resolveTxnMetaByVersion(evt.transaction_version);
    const data = evt.data ?? {};
    const orderId = Number.parseInt(data.order_id ?? data.orderId ?? '0', 10);
    const pricing = data.pricing ?? {};
    await this.orders.applyOrderCreatedEvent({
      txnVersion: BigInt(evt.transaction_version),
      eventIndex: BigInt(evt.event_index),
      txnHash: meta?.hash, chainTimestamp: meta?.timestamp,
      orderId,
      seller: String(data.seller ?? data.creator ?? data.seller_address ?? ''),
      warehouse: String(data.warehouse ?? data.warehouse_address ?? ''),
      logisticsInbound: data.logistics_inbound ?? data.inbound_logistics ?? null,
      pricing: {
        amount: Number(pricing.amount ?? 0),
        insuranceFee: Number(pricing.insurance_fee ?? pricing.insuranceFee ?? 0),
        platformFee: Number(pricing.platform_fee ?? pricing.platformFee ?? 0),
        total: Number(pricing.total ?? 0)
      }
    });
    this.lastTxnVersion = BigInt(evt.transaction_version);
    this.lastEventIndex = BigInt(evt.event_index);
  }

  private async resolveTxnMetaByVersion(version: string): Promise<{ hash: string; timestamp: Date } | null> {
    try {
      const base = (this.nodeApiUrl || '').replace(/\/$/, '');
      const headers: Record<string, string> = this.aptosApiKey
        ? { 'x-aptos-api-key': this.aptosApiKey, Authorization: `Bearer ${this.aptosApiKey}` }
        : {};
      const resp = await fetch(`${base}/transactions/by_version/${version}`, { headers });
      if (!resp.ok) return null;
      const json = (await resp.json()) as { hash?: string; timestamp?: string | number };
      const hash = typeof json?.hash === 'string' ? json.hash : '';
      const micro = typeof json?.timestamp === 'string' ? Number(json.timestamp) : (json?.timestamp as number) ?? 0;
      const ts = Number.isFinite(micro) && micro > 0 ? new Date(Math.floor(micro / 1000)) : new Date();
      if (!hash) return null;
      return { hash, timestamp: ts };
    } catch (e) { this.logger.warn(`Fullnode fallback failed: ${String(e)}`); return null; }
  }
}
```

### 3) FE Hook 草稿锚点（apps/web/features/orders/useOrderDraft.ts）
```ts
'use client';
import { useCallback, useState } from 'react';
import type { PricingBreakdown } from '@shared/dto/orders';
import { buildUrl, parseJson } from '../../lib/api/client';

export function useOrderDraft() {
  const [recordUid, setRecordUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createDraft = useCallback(async (input: {
    sellerAddress: string;
    warehouseAddress: string;
    inboundLogistics?: string | null;
    pricing: PricingBreakdown;
    initialMedia?: { category: string; hashValue: string } | null;
  }) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(buildUrl('/api/orders/drafts'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!res.ok) throw new Error((await parseJson<{ message?: string }>(res))?.message || 'Draft creation failed');
      const body = await parseJson<{ recordUid: string }>(res);
      setRecordUid(body?.recordUid ?? null);
      return body?.recordUid ?? null;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
    finally { setLoading(false); }
  }, []);

  return { recordUid, loading, error, createDraft };
}
```

### 4) 参考 Anchor（已存在）
- Move：create_order 与 OrderCreated 见 `move/sources/orders.move:196` 附近（已实现）。
- FE：创建向导与提交逻辑已存在 `apps/web/features/orders/create/CreateOrderView.tsx`，本次仅新增 useOrderDraft 可选集成。

## 四、实施步骤（分阶段）
1. DB 迁移
   - 添加 Order/OrderEvent 模型，生成迁移并部署到本地/测试库。
2. BFF 模块
   - 新建 OrdersModule（controller/service/repository）；实现三个端点（POST drafts / GET detail / GET list）。
   - 新建 OrdersEventListener，按 10.4 轮询 Indexer，落库订单并补齐 txn_hash/timestamp（Fullnode 兜底）。
   - 将 OrdersModule 挂载到 AppModule；配置项沿用 `indexerUrl`、`nodeApiUrl`、`aptosApiKey`。
3. FE 集成
   - 新增 useOrderDraft（可选）；CreateOrderView 在“Review”页调用 BFF 创建草稿，展示返回 recordUid。
4. 观测与补偿
   - 指标：poll 延迟、Fullnode 兜底次数；错误率；导出 `order_listener_last_version`、`order_listener_error_total`（参考 docs/architecture/6-部署与环境.md:6.3.3）。
   - 定时补偿任务：重试缺失 txn_hash 的订单（可沿用 R1 思路，后续拆 Story）。
5. 文档回填
   - 更新 docs/architecture/10-场景化端到端数据流.md 的 O1 实施状态与 Anchor 路径；
   - 更新 docs/architecture/4-链下服务与数据流.md 的 Orders 模块表格。

## 五、测试计划（Unit → Integration → E2E）
- 单元测试（apps/bff/test）
  - orders.repository.spec.ts：
    - createDraft 持久化 payloadJson 与状态 ORDER_DRAFT。
    - upsertOnchainCreated 幂等（相同 cursor 不重复写）。
  - orders-event-listener.spec.ts：
    - Indexer 返回一批 OrderCreated 事件 → 调用 applyOrderCreatedEvent，校验游标推进。
    - Fullnode by_version 返回 404 → 兜底失败路径记录 warn，仍写入订单并保留空 txn_hash（待补偿）。
- 集成测试
  - orders.controller.spec.ts：POST /api/orders/drafts → 返回 recordUid；GET /api/orders/:uid → 404→事件后 200；GET /api/orders 列表按时间降序。
- 前端测试
  - CreateOrderView.test.tsx 已覆盖提交/回显流程；新增用例：与 useOrderDraft 集成后可显示 recordUid。
 - 安全测试
   - /api/orders/drafts 必须校验 `sellerAddress` 基本格式（0x…），并按文档 7-安全合规与运维 预留“签名+nonce”校验位（PoC 可先记录 IP 与地址并限流）。

## 六、验收标准（Acceptance）
- 功能验收
  - 商家可通过 FE 完成订单向导并在钱包成功签署 create_order；
  - 事件被 BFF 监听并在 30s 内更新 orders.status=ONCHAIN_CREATED，GET /api/orders/:recordUid 返回 transactionHash；
  - Indexer 缺失事务元数据时，通过 Fullnode by_version 获取 txn_hash 与 timestamp；
  - /api/orders 列表包含该订单的摘要信息，时间线包含 OrderCreated；
- 质量门槛
  - 所有新增测试通过；BFF 构建不含 TS 错误；
  - 关键路径均有日志与告警点（poll 失败、兜底失败）。
  - 配置项兼容部署文档：支持 `ORDER_INGESTOR_INTERVAL_MS`、`ORDER_INGESTOR_PAGE_SIZE`，Fullnode 请求在有 key 时同时携带 `x-aptos-api-key` 与 `Authorization` 头。
- 文档对齐
  - 10 章与 4 章 Anchor 均已回填到具体路径/文件名；

## 七、发布与回滚
- 发布：数据库迁移 → 部署 BFF → 校验监听日志与指标 → 前端切换。
- 回滚：停用 OrdersEventListener；保留 DB 表（向前兼容）；前端继续本地模拟（不影响注册场景）。

```
Checklist（实施顺序）
[x] Prisma 迁移合并：`apps/bff/prisma/migrations/2025-09-19_001_o1_orders/migration.sql`
[x] OrdersModule（三端点）骨架实现
[x] OrdersEventListener 初版接入 Fullnode 兜底
[x] FE 集成 useOrderDraft 并在 Review 显示 recordUid
[x] 文档 Anchor 回填（4/5 章节）
[ ] 联调验证与指标接入（进行中）
[ ] 全量测试套件绿灯（受既有 Jest 配置影响，单独用例已补齐）
```
