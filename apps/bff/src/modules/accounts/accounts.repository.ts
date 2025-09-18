import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Account as AccountModel, AccountRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

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

@Injectable()
export class AccountsRepository {
  private readonly logger = new Logger(AccountsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createAccount(input: AccountUpsertInput): Promise<AccountModel> {
    return this.prisma.account.create({
      data: this.mapInputToCreate(input)
    });
  }

  async findByAddress(accountAddress: string): Promise<AccountModel | null> {
    return this.prisma.account.findUnique({
      where: { accountAddress }
    });
  }

  async updateProfile(accountAddress: string, input: AccountUpsertInput): Promise<AccountModel> {
    return this.prisma.account.update({
      where: { accountAddress },
      data: this.mapInputToUpdate(input)
    });
  }

  async upsertFromEvent(input: AccountUpsertInput): Promise<AccountModel> {
    const existing = await this.findByAddress(input.accountAddress);

    if (!existing) {
      this.logger.debug(`Creating new account ${input.accountAddress} from event ${input.txnVersion}:${input.eventIndex}`);
      return this.createAccount(input);
    }

    const shouldSkip =
      existing.txnVersion > input.txnVersion ||
      (existing.txnVersion === input.txnVersion && existing.eventIndex >= input.eventIndex);

    if (shouldSkip) {
      this.logger.debug(
        `Skipping outdated event for ${input.accountAddress} (existing ${existing.txnVersion}:${existing.eventIndex}, incoming ${input.txnVersion}:${input.eventIndex})`
      );
      return existing;
    }

    this.logger.debug(`Updating account ${input.accountAddress} from event ${input.txnVersion}:${input.eventIndex}`);
    return this.updateProfile(input.accountAddress, input);
  }

  async getLatestProcessedEvent(): Promise<{ txnVersion: bigint; eventIndex: bigint } | null> {
    const latest = await this.prisma.account.findFirst({
      orderBy: [
        {
          txnVersion: 'desc'
        },
        {
          eventIndex: 'desc'
        }
      ]
    });

    if (!latest) {
      return null;
    }

    return { txnVersion: latest.txnVersion, eventIndex: latest.eventIndex };
  }

  private mapInputToCreate(input: AccountUpsertInput): Prisma.AccountCreateInput {
    return {
      accountAddress: input.accountAddress,
      role: this.toAccountRole(input.role),
      profileHashAlgo: 'blake3',
      profileHashValue: input.profileHashValue,
      profileUri: input.profileUri ?? null,
      registeredBy: input.registeredBy,
      txnVersion: input.txnVersion,
      eventIndex: input.eventIndex,
      txnHash: input.txnHash,
      chainTimestamp: input.chainTimestamp
    };
  }

  private mapInputToUpdate(input: AccountUpsertInput): Prisma.AccountUpdateInput {
    return {
      role: this.toAccountRole(input.role),
      profileHashAlgo: 'blake3',
      profileHashValue: input.profileHashValue,
      profileUri: input.profileUri ?? null,
      registeredBy: input.registeredBy,
      txnVersion: input.txnVersion,
      eventIndex: input.eventIndex,
      txnHash: input.txnHash,
      chainTimestamp: input.chainTimestamp
    };
  }

  private toAccountRole(role: 'seller' | 'warehouse'): AccountRole {
    return role === 'seller' ? AccountRole.seller : AccountRole.warehouse;
  }
}
