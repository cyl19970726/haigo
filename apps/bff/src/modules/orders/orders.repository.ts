import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { CreateOrderDraftDto } from './dto/create-order-draft.dto.js';
import type { ListSummariesOptions, ListSummariesResult } from './types/list-summaries.js';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(dto: CreateOrderDraftDto): Promise<string> {
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
        }
      }
    });
    return recordUid;
  }

  async upsertOnchainCreated(evt: {
    txnVersion: bigint; eventIndex: bigint; txnHash?: string | null; chainTimestamp?: Date | null;
    orderId: number; seller: string; warehouse: string; logisticsInbound?: string | null;
    pricing: { amount: number; insuranceFee: number; platformFee: number; total: number };
  }): Promise<void> {
    // Prefer merging into an existing draft row if txnHash is known and attached
    let targetRecordUid: string | null = null;
    if (evt.txnHash) {
      const existing = await this.prisma.order.findFirst({ where: { txnHash: evt.txnHash } });
      if (existing?.recordUid) {
        targetRecordUid = existing.recordUid;
        await this.prisma.order.update({
          where: { recordUid: targetRecordUid },
          data: {
            status: 'ONCHAIN_CREATED' as any,
            creatorAddress: evt.seller.toLowerCase(),
            warehouseAddress: evt.warehouse.toLowerCase(),
            orderId: evt.orderId,
            txnVersion: evt.txnVersion,
            eventIndex: evt.eventIndex,
            chainTimestamp: evt.chainTimestamp ?? null
          }
        });
      }
    }

    if (!targetRecordUid) {
      // Fallback: create or update by deterministic on-chain UID
      const fallbackUid = `order-${evt.orderId}${evt.txnHash ? `-${String(evt.txnHash).slice(2, 10)}` : ''}`;
      targetRecordUid = fallbackUid;
      await this.prisma.order.upsert({
        where: { recordUid: targetRecordUid },
        create: {
          recordUid: targetRecordUid,
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
    }

    await this.prisma.orderEvent.upsert({
      where: {
        txnVersion_eventIndex: {
          txnVersion: evt.txnVersion as unknown as bigint,
          eventIndex: evt.eventIndex as unknown as bigint
        } as any
      },
      create: {
        recordUid: targetRecordUid,
        orderId: evt.orderId,
        type: 'OrderCreated',
        txnVersion: evt.txnVersion as unknown as bigint,
        eventIndex: evt.eventIndex as unknown as bigint,
        txnHash: evt.txnHash ?? null,
        chainTimestamp: evt.chainTimestamp ?? null,
        data: {
          pricing: evt.pricing,
          logistics_inbound: evt.logisticsInbound ?? null
        }
      },
      update: {}
    });
  }

  private mapStatus(status: string): OrderSummaryDto['status'] {
    switch (status) {
      case 'ORDER_DRAFT':
        return 'PENDING';
      case 'ONCHAIN_CREATED':
        return 'CREATED';
      case 'WAREHOUSE_IN':
        return 'WAREHOUSE_IN';
      case 'IN_STORAGE':
        return 'IN_STORAGE';
      case 'WAREHOUSE_OUT':
        return 'WAREHOUSE_OUT';
      default:
        return 'PENDING';
    }
  }

  private toPricing(value: any): OrderSummaryDto['pricing'] {
    const p = value ?? {};
    const precision = 100_000_000;
    return {
      amountSubunits: Number(p.amountSubunits ?? p.amount ?? 0),
      insuranceFeeSubunits: Number(p.insuranceFeeSubunits ?? p.insurance_fee ?? p.insuranceFee ?? 0),
      platformFeeSubunits: Number(p.platformFeeSubunits ?? p.platform_fee ?? p.platformFee ?? 0),
      totalSubunits: Number(p.totalSubunits ?? p.total ?? 0),
      currency: 'APT',
      precision
    };
  }

  private mapStatusFilter(status: OrderSummaryDto['status']): string[] {
    switch (status) {
      case 'PENDING':
        return ['ORDER_DRAFT'];
      case 'CREATED':
        return ['ONCHAIN_CREATED'];
      case 'WAREHOUSE_IN':
        return ['WAREHOUSE_IN'];
      case 'IN_STORAGE':
        return ['IN_STORAGE'];
      case 'WAREHOUSE_OUT':
        return ['WAREHOUSE_OUT'];
      default:
        return ['ORDER_DRAFT'];
    }
  }

  async listSummaries(options: ListSummariesOptions = {}): Promise<ListSummariesResult> {
    const page = Math.max(options.page ?? 1, 1);
    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);

    const where: Prisma.OrderWhereInput = {};
    if (options.sellerAddress) {
      where.creatorAddress = options.sellerAddress.toLowerCase();
    }
    if (options.warehouseAddress) {
      where.warehouseAddress = options.warehouseAddress.toLowerCase();
    }
    if (options.status) {
      const statuses = this.mapStatusFilter(options.status);
      where.status = statuses.length > 1 ? { in: statuses as any } : (statuses[0] as any);
    }

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    const recordUids = orders.map((order) => order.recordUid);
    const createdEvents = recordUids.length
      ? await this.prisma.orderEvent.findMany({
          where: { recordUid: { in: recordUids }, type: 'OrderCreated' },
          orderBy: [{ txnVersion: 'desc' }, { eventIndex: 'desc' }]
        })
      : [];

    const latestCreatedEventByRecordUid = new Map<string, (typeof createdEvents)[number]>();
    for (const event of createdEvents) {
      if (!latestCreatedEventByRecordUid.has(event.recordUid)) {
        latestCreatedEventByRecordUid.set(event.recordUid, event);
      }
    }

    const items: OrderSummaryDto[] = orders.map((order) => {
      const payloadPricing = (order as any)?.payloadJson?.pricing;
      const latestEvent = latestCreatedEventByRecordUid.get(order.recordUid);
      const eventPricing = (latestEvent as any)?.data?.pricing;

      const pricing = this.toPricing(
        order.status === ('ORDER_DRAFT' as any)
          ? payloadPricing ?? eventPricing
          : eventPricing ?? payloadPricing
      );

      return {
        recordUid: order.recordUid,
        orderId: Number(order.orderId ?? 0),
        status: this.mapStatus(order.status as any),
        warehouseAddress: order.warehouseAddress,
        pricing,
        createdAt: (order.createdAt ?? new Date()).toISOString(),
        updatedAt: (order.updatedAt ?? new Date()).toISOString(),
        transactionHash: order.txnHash ?? undefined
      } satisfies OrderSummaryDto;
    });

    return {
      items,
      total,
      page,
      pageSize
    } satisfies ListSummariesResult;
  }

  async getDetail(recordUid: string): Promise<OrderDetailDto | null> {
    const order = await this.prisma.order.findUnique({ where: { recordUid } });
    if (!order) return null;
    const events = await this.prisma.orderEvent.findMany({ where: { recordUid }, orderBy: [{ txnVersion: 'asc' }] });
    const media = await this.prisma.mediaAsset.findMany({ where: { recordUid } });
    // resolve pricing (draft payload or latest event)
    let pricing = null as null | OrderSummaryDto['pricing'];
    if ((order.status as any) === 'ORDER_DRAFT' && (order as any).payloadJson?.pricing) {
      pricing = this.toPricing((order as any).payloadJson.pricing);
    } else {
      const latest = events
        .slice()
        .reverse()
        .find((e) => e.type === 'OrderCreated');
      pricing = this.toPricing((latest as any)?.data?.pricing ?? (order as any).payloadJson?.pricing);
    }

    return {
      recordUid: order.recordUid,
      orderId: Number(order.orderId ?? 0),
      status: this.mapStatus(order.status as any),
      warehouseAddress: order.warehouseAddress,
      pricing: pricing ?? this.toPricing(null),
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

  async attachTransaction(recordUid: string, txnHash: string): Promise<void> {
    await this.prisma.order.update({
      where: { recordUid },
      data: { txnHash }
    });
  }
}
