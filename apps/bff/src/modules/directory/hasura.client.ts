import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface HasuraWarehouseProfile {
  name?: string;
  creditScore?: number;
  creditCapacity?: number;
  serviceAreas?: string[];
  mediaSamples?: string[];
  availability?: string;
  lastAuditAt?: string;
}

@Injectable()
export class HasuraClient {
  private readonly logger = new Logger(HasuraClient.name);
  private readonly endpoint: string;
  private readonly adminSecret?: string;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('hasuraUrl', 'http://localhost:8080');
    this.endpoint = raw.endsWith('/v1/graphql') ? raw : `${raw.replace(/\/$/, '')}/v1/graphql`;
    this.adminSecret = this.configService.get<string>('hasuraAdminSecret') || process.env.HASURA_ADMIN_SECRET;
  }

  async fetchWarehouseProfiles(addresses: string[]): Promise<Record<string, HasuraWarehouseProfile>> {
    if (!addresses.length) {
      return {};
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          query: /* GraphQL */ `
            query FetchWarehouseProfiles($addresses: [String!]!) {
              warehouse_profiles(where: { warehouse_address: { _in: $addresses } }) {
                warehouse_address
                name
                credit_score
                credit_capacity
                availability
                service_areas
                media_samples
                last_audit_at
              }
            }
          `,
          variables: { addresses }
        })
      });

      if (!response.ok) {
        throw new Error(`Hasura responded with status ${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: {
          warehouse_profiles?: Array<{
            warehouse_address: string;
            name?: string | null;
            credit_score?: number | null;
            credit_capacity?: number | null;
            availability?: string | null;
            service_areas?: string[] | null;
            media_samples?: string[] | null;
            last_audit_at?: string | null;
          }>;
        };
        errors?: Array<{ message: string }>;
      };

      if (payload.errors?.length) {
        throw new Error(payload.errors.map((error) => error.message).join('; '));
      }

      const map: Record<string, HasuraWarehouseProfile> = {};
      for (const item of payload.data?.warehouse_profiles ?? []) {
        const address = item.warehouse_address?.toLowerCase();
        if (!address) continue;
        map[address] = {
          name: item.name ?? undefined,
          creditScore: Number.isFinite(item.credit_score) ? Number(item.credit_score) : undefined,
          creditCapacity: Number.isFinite(item.credit_capacity) ? Number(item.credit_capacity) : undefined,
          availability: item.availability ?? undefined,
          serviceAreas: Array.isArray(item.service_areas) ? item.service_areas.filter(Boolean) : undefined,
          mediaSamples: Array.isArray(item.media_samples) ? item.media_samples.filter(Boolean) : undefined,
          lastAuditAt: item.last_audit_at ?? undefined
        };
      }

      return map;
    } catch (error) {
      this.logger.warn(`Failed to fetch warehouse profiles from Hasura: ${this.stringifyError(error)}`);
      return {};
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };
    if (this.adminSecret) {
      headers['x-hasura-admin-secret'] = this.adminSecret;
    } else {
      headers['x-hasura-role'] = 'anonymous';
    }
    return headers;
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
