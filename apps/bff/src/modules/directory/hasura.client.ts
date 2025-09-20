import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendDebugLog, sanitizeHeaders } from '../../common/debug-log.util.js';

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
  private readonly authToken?: string;
  private readonly debugLogDir?: string;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('hasuraUrl', 'http://localhost:8080');
    this.endpoint = raw.endsWith('/v1/graphql') ? raw : `${raw.replace(/\/$/, '')}/v1/graphql`;
    const secret = this.configService.get<string>('hasuraAdminSecret') || process.env.HASURA_ADMIN_SECRET;
    this.adminSecret = secret ? secret.trim() || undefined : undefined;
    const token = this.configService.get<string>('hasuraAuthToken') || process.env.HASURA_AUTH_TOKEN;
    this.authToken = token ? token.trim() || undefined : undefined;
    const debugDir = this.configService.get<string>('debug.logDir') || process.env.BFF_DEBUG_LOG_DIR;
    this.debugLogDir = debugDir ? debugDir.trim() || undefined : undefined;
  }

  async fetchWarehouseProfiles(addresses: string[]): Promise<Record<string, HasuraWarehouseProfile>> {
    if (!addresses.length) {
      return {};
    }

    try {
      const requestBody = {
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
      };

      const headers = this.buildHeaders();

      await this.appendHasuraDebug('directory-warehouse-profiles', {
        phase: 'request',
        addresses,
        url: this.endpoint,
        headers: sanitizeHeaders(headers),
        body: requestBody
      });

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      const raw = await response.text();

      await this.appendHasuraDebug('directory-warehouse-profiles', {
        phase: 'response',
        addresses,
        status: response.status,
        ok: response.ok,
        raw
      });

      if (!response.ok) {
        throw new Error(`Hasura responded with status ${response.status}`);
      }

      const payload = this.parseHasuraPayload(raw) as {
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
      await this.appendHasuraDebug('directory-warehouse-profiles', {
        phase: 'error',
        addresses,
        error: this.stringifyError(error)
      });
      this.logger.warn(`Failed to fetch warehouse profiles from Hasura: ${this.stringifyError(error)}`);
      return {};
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };
    if (this.authToken) {
      headers.authorization = this.authToken.startsWith('Bearer ')
        ? this.authToken
        : `Bearer ${this.authToken}`;
    }
    if (this.adminSecret) {
      headers['x-hasura-admin-secret'] = this.adminSecret;
    } else if (!this.authToken) {
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
