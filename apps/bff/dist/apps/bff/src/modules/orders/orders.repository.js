var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
let OrdersRepository = class OrdersRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createDraft(dto) {
        const recordUid = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await this.prisma.order.create({
            data: {
                recordUid,
                creatorAddress: dto.sellerAddress.toLowerCase(),
                warehouseAddress: dto.warehouseAddress.toLowerCase(),
                status: 'ORDER_DRAFT',
                payloadJson: {
                    inboundLogistics: dto.inboundLogistics ?? null,
                    pricing: dto.pricing,
                    initialMedia: dto.initialMedia ?? null
                }
            }
        });
        return recordUid;
    }
    async upsertOnchainCreated(evt) {
        const recordUid = `order-${evt.orderId}${evt.txnHash ? `-${String(evt.txnHash).slice(2, 10)}` : ''}`;
        await this.prisma.order.upsert({
            where: { recordUid },
            create: {
                recordUid,
                creatorAddress: evt.seller.toLowerCase(),
                warehouseAddress: evt.warehouse.toLowerCase(),
                status: 'ONCHAIN_CREATED',
                orderId: evt.orderId,
                txnVersion: evt.txnVersion,
                eventIndex: evt.eventIndex,
                txnHash: evt.txnHash ?? null,
                chainTimestamp: evt.chainTimestamp ?? null
            },
            update: {
                status: 'ONCHAIN_CREATED',
                orderId: evt.orderId,
                txnVersion: evt.txnVersion,
                eventIndex: evt.eventIndex,
                txnHash: evt.txnHash ?? null,
                chainTimestamp: evt.chainTimestamp ?? null
            }
        });
        await this.prisma.orderEvent.upsert({
            where: { txnVersion_eventIndex: { txnVersion: evt.txnVersion, eventIndex: evt.eventIndex } },
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
            update: {}
        });
    }
    async listSummaries(filter) {
        const where = filter?.sellerAddress ? { creatorAddress: filter.sellerAddress.toLowerCase() } : {};
        const items = await this.prisma.order.findMany({ where, orderBy: [{ createdAt: 'desc' }] });
        return items.map((o) => ({
            recordUid: o.recordUid,
            orderId: Number(o.orderId ?? 0),
            status: o.status.replace('ONCHAIN_', '') ?? 'PENDING',
            warehouseAddress: o.warehouseAddress,
            pricing: {
                amountSubunits: Number(o.amountSubunits ?? 0),
                insuranceFeeSubunits: Number(o.insuranceFeeSubunits ?? 0),
                platformFeeSubunits: Number(o.platformFeeSubunits ?? 0),
                totalSubunits: Number(o.totalSubunits ?? 0),
                currency: 'APT',
                precision: 100_000_000
            },
            createdAt: (o.createdAt ?? new Date()).toISOString(),
            updatedAt: (o.updatedAt ?? new Date()).toISOString(),
            transactionHash: o.txnHash ?? undefined
        }));
    }
    async getDetail(recordUid) {
        const order = await this.prisma.order.findUnique({ where: { recordUid } });
        if (!order)
            return null;
        const events = await this.prisma.orderEvent.findMany({ where: { recordUid }, orderBy: [{ txnVersion: 'asc' }] });
        const media = await this.prisma.mediaAsset.findMany({ where: { recordUid } });
        return {
            recordUid: order.recordUid,
            orderId: Number(order.orderId ?? 0),
            status: order.status.replace('ONCHAIN_', '') ?? 'PENDING',
            warehouseAddress: order.warehouseAddress,
            pricing: {
                amountSubunits: Number(order.amountSubunits ?? 0),
                insuranceFeeSubunits: Number(order.insuranceFeeSubunits ?? 0),
                platformFeeSubunits: Number(order.platformFeeSubunits ?? 0),
                totalSubunits: Number(order.totalSubunits ?? 0),
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
                stage: m.stage,
                category: m.category,
                hashAlgorithm: m.hashAlgo,
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
};
OrdersRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], OrdersRepository);
export { OrdersRepository };
