import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import type { CreateOrderDraftDto } from './dto/create-order-draft.dto.js';

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
    const recordUid = `order-${evt.orderId}${evt.txnHash ? `-${String(evt.txnHash).slice(2, 10)}` : ''}`;
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

    await this.prisma.orderEvent.upsert({
      where: { txnVersion_eventIndex: { txnVersion: evt.txnVersion as unknown as bigint, eventIndex: evt.eventIndex as unknown as bigint } as any },
      create: {
        recordUid,
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

  async listSummaries(filter?: { sellerAddress?: string }): Promise<OrderSummaryDto[]> {
    const where = filter?.sellerAddress ? { creatorAddress: filter.sellerAddress.toLowerCase() } : {};
    const items = await this.prisma.order.findMany({ where, orderBy: [{ createdAt: 'desc' }] });
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

