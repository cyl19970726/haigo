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
export declare class StakingRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getLatestCursor(): Promise<{
        version: bigint;
        index: bigint;
    } | null>;
    upsertStake(i: StakeUpsertInput): Promise<void>;
    upsertFee(i: FeeUpsertInput): Promise<void>;
    readIntent(address: string): Promise<{
        stakedAmount?: bigint;
        feePerUnit?: number;
    } | null>;
}
