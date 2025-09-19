import { Account as AccountModel } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
export interface AccountUpsertInput {
    accountAddress: string;
    role: 'seller' | 'warehouse';
    profileHashValue: string;
    profileUri?: string | null;
    registeredBy: string;
    txnVersion: bigint;
    eventIndex: bigint;
    txnHash: string;
    chainTimestamp: Date;
}
export declare class AccountsRepository {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    createAccount(input: AccountUpsertInput): Promise<AccountModel>;
    findByAddress(accountAddress: string): Promise<AccountModel | null>;
    updateProfile(accountAddress: string, input: AccountUpsertInput): Promise<AccountModel>;
    upsertFromEvent(input: AccountUpsertInput): Promise<AccountModel>;
    getLatestProcessedEvent(): Promise<{
        txnVersion: bigint;
        eventIndex: bigint;
    } | null>;
    private mapInputToCreate;
    private mapInputToUpdate;
    private toAccountRole;
}
