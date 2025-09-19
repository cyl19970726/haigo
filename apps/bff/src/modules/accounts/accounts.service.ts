import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { Account as AccountModel, AccountRole } from '@prisma/client';
import { AccountProfile } from '@haigo/shared/dto/registry';
import type { Express } from 'express';
import { AccountsRepository } from './accounts.repository.js';

type AccountRoleLiteral = 'seller' | 'warehouse';

interface OrderCountResponse {
  sellerCount: number;
  warehouseCount: number;
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);
  private readonly hasuraUrl: string;

  constructor(private readonly accountsRepository: AccountsRepository, private readonly configService: ConfigService) {
    this.hasuraUrl = this.configService.get<string>('hasuraUrl', 'http://localhost:8080/v1/graphql');
  }

  async getAccountProfile(address: string): Promise<AccountProfile> {
    const normalizedAddress = this.normalizeAddress(address);
    if (!normalizedAddress) {
      throw new BadRequestException('Invalid account address');
    }

    const account = await this.accountsRepository.findByAddress(normalizedAddress);
    if (!account) {
      throw new NotFoundException(`Account ${normalizedAddress} not found`);
    }

    const profile: AccountProfile = {
      address: normalizedAddress,
      role: this.toLiteralRole(account.role),
      profileHash: {
        algorithm: 'blake3',
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
    } catch (error) {
      this.logger.warn(`Failed to fetch order counts for ${normalizedAddress}: ${this.stringifyError(error)}`);
    }

    return profile;
  }

  async verifyProfileHash(address: string, file: Express.Multer.File): Promise<{
    verified: boolean;
    computedHash: string;
    storedHash: string;
  }> {
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

  private async fetchOrderCount(address: string): Promise<OrderCountResponse | null> {
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

      const payload = (await response.json()) as {
        data?: {
          seller?: { aggregate?: { count?: number | null } | null } | null;
          warehouse?: { aggregate?: { count?: number | null } | null } | null;
        };
        errors?: Array<{ message: string }>;
      };

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
    } catch (error) {
      this.logger.warn(`Hasura order count fetch failed: ${this.stringifyError(error)}`);
      return null;
    }
  }

  private hasuraGraphqlUrl(): string {
    if (this.hasuraUrl.endsWith('/v1/graphql')) {
      return this.hasuraUrl;
    }
    return `${this.hasuraUrl.replace(/\/$/, '')}/v1/graphql`;
  }

  private normalizeAddress(address: string | undefined): string {
    if (!address) {
      return '';
    }

    const normalized = address.toLowerCase();
    return /^0x[a-f0-9]{1,64}$/.test(normalized) ? normalized : '';
  }

  private toLiteralRole(role: AccountRole): AccountRoleLiteral {
    return role === AccountRole.seller ? 'seller' : 'warehouse';
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return JSON.stringify(error);
  }
}
