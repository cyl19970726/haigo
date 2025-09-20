import { Account, AccountRole, Prisma } from '@prisma/client';

export class MockPrismaService {
  private readonly store = new Map<string, Account>();

  account = {
    create: async ({ data }: { data: Prisma.AccountCreateInput }): Promise<Account> => {
      const entity = this.toAccountEntity(data);
      this.store.set(entity.accountAddress, entity);
      return entity;
    },
    findUnique: async ({ where }: Prisma.AccountFindUniqueArgs): Promise<Account | null> => {
      if (!where?.accountAddress) {
        return null;
      }
      return this.store.get(where.accountAddress) ?? null;
    },
    update: async ({ where, data }: Prisma.AccountUpdateArgs): Promise<Account> => {
      if (!where.accountAddress) {
        throw new Error('accountAddress is required for update');
      }
      const existing = this.store.get(where.accountAddress);
      if (!existing) {
        throw new Error(`Account ${where.accountAddress} not found`);
      }
      const updated = this.applyUpdate(existing, data);
      this.store.set(where.accountAddress, updated);
      return updated;
    },
    findFirst: async ({ orderBy }: Prisma.AccountFindFirstArgs): Promise<Account | null> => {
      if (this.store.size === 0) {
        return null;
      }
      const items = Array.from(this.store.values());
      if (!orderBy) {
        return items[0];
      }
      const sorted = items.sort((a, b) => {
        const versionCompare = Number(b.txnVersion - a.txnVersion);
        if (versionCompare !== 0) {
          return versionCompare;
        }
        return Number(b.eventIndex - a.eventIndex);
      });
      return sorted[0];
    }
  };

  reset(): void {
    this.store.clear();
  }

  private toAccountEntity(data: Prisma.AccountCreateInput): Account {
    const now = new Date();
    return {
      accountAddress: data.accountAddress,
      role: data.role as AccountRole,
      profileHashAlgo: (data.profileHashAlgo as string) ?? 'blake3',
      profileHashValue: data.profileHashValue as string,
      profileUri: (data.profileUri ?? null) as string | null,
      registeredBy: data.registeredBy as string,
      txnVersion: (data.txnVersion as bigint) ?? BigInt(0),
      eventIndex: (data.eventIndex as bigint) ?? BigInt(0),
      txnHash: data.txnHash as string,
      chainTimestamp: data.chainTimestamp as Date,
      createdAt: (data.createdAt as Date | undefined) ?? now,
      updatedAt: (data.updatedAt as Date | undefined) ?? now
    };
  }

  private applyUpdate(existing: Account, data: Prisma.AccountUpdateInput): Account {
    return {
      ...existing,
      role: (data.role as AccountRole) ?? existing.role,
      profileHashAlgo: (data.profileHashAlgo as string) ?? existing.profileHashAlgo,
      profileHashValue: (data.profileHashValue as string) ?? existing.profileHashValue,
      profileUri: (data.profileUri as string | null | undefined) ?? existing.profileUri,
      registeredBy: (data.registeredBy as string) ?? existing.registeredBy,
      txnVersion: (data.txnVersion as bigint) ?? existing.txnVersion,
      eventIndex: (data.eventIndex as bigint) ?? existing.eventIndex,
      txnHash: (data.txnHash as string) ?? existing.txnHash,
      chainTimestamp: (data.chainTimestamp as Date) ?? existing.chainTimestamp,
      updatedAt: new Date()
    };
  }
}
