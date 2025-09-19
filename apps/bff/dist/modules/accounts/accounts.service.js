var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AccountsService_1;
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { AccountRole } from '@prisma/client';
import { AccountsRepository } from './accounts.repository.js';
let AccountsService = AccountsService_1 = class AccountsService {
    constructor(accountsRepository, configService) {
        this.accountsRepository = accountsRepository;
        this.configService = configService;
        this.logger = new Logger(AccountsService_1.name);
        this.hasuraUrl = this.configService.get('hasuraUrl', 'http://localhost:8080/v1/graphql');
    }
    async getAccountProfile(address) {
        const normalizedAddress = this.normalizeAddress(address);
        if (!normalizedAddress) {
            throw new BadRequestException('Invalid account address');
        }
        const account = await this.accountsRepository.findByAddress(normalizedAddress);
        if (!account) {
            throw new NotFoundException(`Account ${normalizedAddress} not found`);
        }
        const profile = {
            address: normalizedAddress,
            role: this.toLiteralRole(account.role),
            profileHash: {
                algo: 'blake3',
                value: account.profileHashValue
            },
            profileUri: account.profileUri ?? undefined,
            registeredAt: account.chainTimestamp.toISOString()
        };
        try {
            const orderCounts = await this.fetchOrderCount(normalizedAddress);
            const role = profile.role;
            if (orderCounts) {
                profile.orderCount = role === 'seller' ? orderCounts.sellerCount : orderCounts.warehouseCount;
            }
        }
        catch (error) {
            this.logger.warn(`Failed to fetch order counts for ${normalizedAddress}: ${this.stringifyError(error)}`);
        }
        return profile;
    }
    async verifyProfileHash(address, file) {
        if (!file) {
            throw new BadRequestException('Verification file is required');
        }
        const normalizedAddress = this.normalizeAddress(address);
        if (!normalizedAddress) {
            throw new BadRequestException('Invalid account address');
        }
        const account = await this.accountsRepository.findByAddress(normalizedAddress);
        if (!account) {
            throw new NotFoundException(`Account ${normalizedAddress} not found`);
        }
        const computedHash = bytesToHex(blake3(new Uint8Array(file.buffer))).toLowerCase();
        const storedHash = account.profileHashValue.toLowerCase();
        const verified = computedHash === storedHash;
        return { verified, computedHash, storedHash };
    }
    async fetchOrderCount(address) {
        try {
            const response = await fetch(this.hasuraGraphqlUrl(), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hasura-role': 'anonymous'
                },
                body: JSON.stringify({
                    query: /* GraphQL */ `
            query AccountOrderCount($address: String!) {
              seller: orders_aggregate(where: { creator_address: { _eq: $address } }) {
                aggregate {
                  count
                }
              }
              warehouse: orders_aggregate(where: { warehouse_address: { _eq: $address } }) {
                aggregate {
                  count
                }
              }
            }
          `,
                    variables: { address }
                })
            });
            if (!response.ok) {
                throw new Error(`Hasura responded with status ${response.status}`);
            }
            const payload = (await response.json());
            if (payload.errors && payload.errors.length > 0) {
                throw new Error(payload.errors.map((error) => error.message).join('; '));
            }
            if (!payload.data) {
                return null;
            }
            return {
                sellerCount: payload.data.seller?.aggregate?.count ?? 0,
                warehouseCount: payload.data.warehouse?.aggregate?.count ?? 0
            };
        }
        catch (error) {
            this.logger.warn(`Hasura order count fetch failed: ${this.stringifyError(error)}`);
            return null;
        }
    }
    hasuraGraphqlUrl() {
        if (this.hasuraUrl.endsWith('/v1/graphql')) {
            return this.hasuraUrl;
        }
        return `${this.hasuraUrl.replace(/\/$/, '')}/v1/graphql`;
    }
    normalizeAddress(address) {
        if (!address) {
            return '';
        }
        const normalized = address.toLowerCase();
        return /^0x[a-f0-9]{1,64}$/.test(normalized) ? normalized : '';
    }
    toLiteralRole(role) {
        return role === AccountRole.seller ? 'seller' : 'warehouse';
    }
    stringifyError(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return JSON.stringify(error);
    }
};
AccountsService = AccountsService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [AccountsRepository, ConfigService])
], AccountsService);
export { AccountsService };
