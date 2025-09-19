var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AccountsRepository_1;
import { Injectable, Logger } from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
let AccountsRepository = AccountsRepository_1 = class AccountsRepository {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new Logger(AccountsRepository_1.name);
    }
    async createAccount(input) {
        return this.prisma.account.create({
            data: this.mapInputToCreate(input)
        });
    }
    async findByAddress(accountAddress) {
        return this.prisma.account.findUnique({
            where: { accountAddress }
        });
    }
    async updateProfile(accountAddress, input) {
        return this.prisma.account.update({
            where: { accountAddress },
            data: this.mapInputToUpdate(input)
        });
    }
    async upsertFromEvent(input) {
        const existing = await this.findByAddress(input.accountAddress);
        if (!existing) {
            this.logger.debug(`Creating new account ${input.accountAddress} from event ${input.txnVersion}:${input.eventIndex}`);
            return this.createAccount(input);
        }
        const shouldSkip = existing.txnVersion > input.txnVersion ||
            (existing.txnVersion === input.txnVersion && existing.eventIndex >= input.eventIndex);
        if (shouldSkip) {
            this.logger.debug(`Skipping outdated event for ${input.accountAddress} (existing ${existing.txnVersion}:${existing.eventIndex}, incoming ${input.txnVersion}:${input.eventIndex})`);
            return existing;
        }
        this.logger.debug(`Updating account ${input.accountAddress} from event ${input.txnVersion}:${input.eventIndex}`);
        return this.updateProfile(input.accountAddress, input);
    }
    async getLatestProcessedEvent() {
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
    mapInputToCreate(input) {
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
    mapInputToUpdate(input) {
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
    toAccountRole(role) {
        return role === 'seller' ? AccountRole.seller : AccountRole.warehouse;
    }
};
AccountsRepository = AccountsRepository_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], AccountsRepository);
export { AccountsRepository };
