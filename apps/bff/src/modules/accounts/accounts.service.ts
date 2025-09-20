import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { Account as AccountModel, AccountRole } from '@prisma/client';
import { AccountProfile } from '@haigo/shared/dto/registry';
import type { Express } from 'express';
import { appendDebugLog, sanitizeHeaders } from '../../common/debug-log.util.js';
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
  private readonly hasuraAdminSecret?: string;
  private readonly hasuraAuthToken?: string;
  private readonly debugLogDir?: string;

  constructor(private readonly accountsRepository: AccountsRepository, private readonly configService: ConfigService) {
    this.hasuraUrl = this.configService.get<string>('hasuraUrl', 'http://localhost:8080/v1/graphql');
    const adminSecret = this.configService.get<string>('hasuraAdminSecret') || process.env.HASURA_ADMIN_SECRET;
    this.hasuraAdminSecret = adminSecret ? adminSecret.trim() || undefined : undefined;
    const authToken = this.configService.get<string>('hasuraAuthToken') || process.env.HASURA_AUTH_TOKEN;
    this.hasuraAuthToken = authToken ? authToken.trim() || undefined : undefined;
    const debugDir = this.configService.get<string>('debug.logDir') || process.env.BFF_DEBUG_LOG_DIR;
    this.debugLogDir = debugDir ? debugDir.trim() || undefined : undefined;
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
      const requestBody = {
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
      };

      const headers = this.buildHasuraHeaders();

      await this.appendHasuraDebug('accounts-order-count', {
        phase: 'request',
        address,
        url: this.hasuraGraphqlUrl(),
        headers: sanitizeHeaders(headers),
        body: requestBody
      });

      const response = await fetch(this.hasuraGraphqlUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      const raw = await response.text();

      await this.appendHasuraDebug('accounts-order-count', {
        phase: 'response',
        address,
        status: response.status,
        ok: response.ok,
        raw
      });

      if (!response.ok) {
        throw new Error(`Hasura responded with status ${response.status}`);
      }

      const payload = this.parseHasuraPayload(raw) as {
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
      await this.appendHasuraDebug('accounts-order-count', {
        phase: 'error',
        address,
        error: this.stringifyError(error)
      });
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

  private buildHasuraHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };
    if (this.hasuraAuthToken) {
      headers.authorization = this.hasuraAuthToken.startsWith('Bearer ')
        ? this.hasuraAuthToken
        : `Bearer ${this.hasuraAuthToken}`;
    }
    if (this.hasuraAdminSecret) {
      headers['x-hasura-admin-secret'] = this.hasuraAdminSecret;
    } else if (!this.hasuraAuthToken) {
      headers['x-hasura-role'] = 'anonymous';
    }
    return headers;
  }

  private parseHasuraPayload(raw: string | undefined) {
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(`Failed to parse Hasura payload: ${this.stringifyError(error)}`);
      return {};
    }
  }

  private async appendHasuraDebug(category: string, entry: Record<string, unknown>): Promise<void> {
    if (!this.debugLogDir) {
      return;
    }
    await appendDebugLog(this.debugLogDir, category, entry);
  }
}
