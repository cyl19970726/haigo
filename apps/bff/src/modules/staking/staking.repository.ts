import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { Prisma } from '@prisma/client';

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
  private readonly logger = new Logger(StakingRepository.name);
  constructor(private readonly prisma: PrismaService) {}

  async getLatestCursor(): Promise<{ version: bigint; index: bigint } | null> {
    try {
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
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
        this.logger.warn('Staking tables not found; did you run Prisma migrations? Falling back to null cursor.');
        return null;
      }
      throw err;
    }
  }

  async upsertStake(i: StakeUpsertInput): Promise<void> {
    try {
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
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
        this.logger.warn('Staking table staking_positions not found; skip upsertStake. Run Prisma migrations.');
        return;
      }
      throw err;
    }
  }

  async upsertFee(i: FeeUpsertInput): Promise<void> {
    try {
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
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
        this.logger.warn('Staking table storage_fees_cache not found; skip upsertFee. Run Prisma migrations.');
        return;
      }
      throw err;
    }
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
