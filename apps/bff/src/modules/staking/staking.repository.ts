import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export interface StakeUpsertInput {
  warehouseAddress: string;
  stakedAmount: bigint;
  txnVersion: bigint;
  eventIndex: bigint;
}

export interface FeeUpsertInput {
  warehouseAddress: string;
  feePerUnit: number;
  txnVersion: bigint;
  eventIndex: bigint;
}

@Injectable()
export class StakingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getLatestCursor(): Promise<{ version: bigint; index: bigint } | null> {
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
    if (maxV < 0n) return null;
    return { version: maxV, index: maxI };
  }

  async upsertStake(i: StakeUpsertInput): Promise<void> {
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

  async upsertFee(i: FeeUpsertInput): Promise<void> {
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

  async readIntent(address: string): Promise<{ stakedAmount?: bigint; feePerUnit?: number } | null> {
    const [pos, fee] = await Promise.all([
      this.prisma.stakingPosition.findUnique({ where: { warehouseAddress: address.toLowerCase() } }),
      this.prisma.storageFeeCache.findUnique({ where: { warehouseAddress: address.toLowerCase() } })
    ]);
    if (!pos && !fee) return null;
    return { stakedAmount: pos?.stakedAmount ?? 0n, feePerUnit: fee?.feePerUnit ?? 0 };
  }
}

