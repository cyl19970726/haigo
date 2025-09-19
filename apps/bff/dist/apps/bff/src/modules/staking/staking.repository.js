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
let StakingRepository = class StakingRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getLatestCursor() {
        const a = await this.prisma.stakingPosition.findFirst({
            orderBy: [
                { lastTxnVersion: 'desc' },
                { lastEventIndex: 'desc' }
            ]
        });
        const b = await this.prisma.storageFeeCache.findFirst({
            orderBy: [
                { lastTxnVersion: 'desc' },
                { lastEventIndex: 'desc' }
            ]
        });
        const v = [a?.lastTxnVersion ?? -1n, b?.lastTxnVersion ?? -1n];
        const i = [a?.lastEventIndex ?? -1n, b?.lastEventIndex ?? -1n];
        const maxV = v.reduce((p, c) => (c > p ? c : p), -1n);
        const maxI = i.reduce((p, c) => (c > p ? c : p), -1n);
        if (maxV < 0n)
            return null;
        return { version: maxV, index: maxI };
    }
    async upsertStake(i) {
        await this.prisma.stakingPosition.upsert({
            where: { warehouseAddress: i.warehouseAddress.toLowerCase() },
            update: {
                stakedAmount: i.stakedAmount,
                lastTxnVersion: i.txnVersion,
                lastEventIndex: i.eventIndex
            },
            create: {
                warehouseAddress: i.warehouseAddress.toLowerCase(),
                stakedAmount: i.stakedAmount,
                lastTxnVersion: i.txnVersion,
                lastEventIndex: i.eventIndex
            }
        });
    }
    async upsertFee(i) {
        await this.prisma.storageFeeCache.upsert({
            where: { warehouseAddress: i.warehouseAddress.toLowerCase() },
            update: {
                feePerUnit: i.feePerUnit,
                lastTxnVersion: i.txnVersion,
                lastEventIndex: i.eventIndex
            },
            create: {
                warehouseAddress: i.warehouseAddress.toLowerCase(),
                feePerUnit: i.feePerUnit,
                lastTxnVersion: i.txnVersion,
                lastEventIndex: i.eventIndex
            }
        });
    }
    async readIntent(address) {
        const [pos, fee] = await Promise.all([
            this.prisma.stakingPosition.findUnique({ where: { warehouseAddress: address.toLowerCase() } }),
            this.prisma.storageFeeCache.findUnique({ where: { warehouseAddress: address.toLowerCase() } })
        ]);
        if (!pos && !fee)
            return null;
        return { stakedAmount: pos?.stakedAmount ?? 0n, feePerUnit: fee?.feePerUnit ?? 0 };
    }
};
StakingRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], StakingRepository);
export { StakingRepository };
