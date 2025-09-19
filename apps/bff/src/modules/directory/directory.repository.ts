import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { HasuraClient } from './hasura.client.js';

type DirectorySort = 'score_desc' | 'fee_asc' | 'capacity_desc' | 'recent';

export interface DirectoryListOptions {
  available?: boolean;
  minScore?: number;
  maxFeeBps?: number;
  area?: string;
  q?: string;
  sort?: DirectorySort;
  page: number;
  pageSize: number;
}

export interface DirectoryListResult {
  items: WarehouseSummary[];
  total: number;
  page: number;
  pageSize: number;
  cacheHit: boolean;
  generatedAt: Date;
}

interface CacheEntry {
  expiresAt: number;
  payload: Omit<DirectoryListResult, 'cacheHit' | 'generatedAt'> & { generatedAt: number };
}

interface WarehouseComputed extends WarehouseSummary {
  feePerUnit?: number;
}

@Injectable()
export class DirectoryRepository {
  private readonly logger = new Logger(DirectoryRepository.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasura: HasuraClient,
    private readonly configService: ConfigService
  ) {
    const fallbackTtl = Number.parseInt(process.env.DIRECTORY_CACHE_TTL_MS ?? '', 10);
    this.cacheTtlMs = this.resolvePositiveNumber(
      this.configService.get<number>('directory.cacheTtlMs') ?? (Number.isFinite(fallbackTtl) ? fallbackTtl : NaN),
      30_000
    );
  }

  async list(options: DirectoryListOptions): Promise<DirectoryListResult> {
    const normalized = this.normalizeOptions(options);
    const cacheKey = JSON.stringify(normalized);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      this.logger.debug(`Directory cache hit for ${cacheKey}`);
      const payload = cached.payload;
      return {
        ...payload,
        generatedAt: new Date(payload.generatedAt),
        cacheHit: true
      };
    }

    // PoC: fetch all warehouse accounts, perform q/name/area filtering after aggregation
    const where: Prisma.AccountWhereInput = { role: 'warehouse' };
    const accounts = await this.prisma.account.findMany({ where });
    const addresses = accounts.map((account) => account.accountAddress.toLowerCase());

    const [positions, fees, hasuraProfiles] = await Promise.all([
      this.prisma.stakingPosition.findMany({ where: { warehouseAddress: { in: addresses } } }),
      this.prisma.storageFeeCache.findMany({ where: { warehouseAddress: { in: addresses } } }),
      this.hasura.fetchWarehouseProfiles(addresses)
    ]);

    const positionMap = new Map(positions.map((item) => [item.warehouseAddress.toLowerCase(), item]));
    const feeMap = new Map(fees.map((item) => [item.warehouseAddress.toLowerCase(), item]));

    const warehouses: WarehouseComputed[] = accounts.map((account) => this.mergeWarehouseData(account, positionMap, feeMap, hasuraProfiles));

    const filtered = this.applyFilters(warehouses, normalized);
    const sorted = this.applySort(filtered, normalized.sort);

    const total = sorted.length;
    const start = (normalized.page - 1) * normalized.pageSize;
    const end = start + normalized.pageSize;
    const pagedItems = sorted.slice(start, end);

    const payload: CacheEntry['payload'] = {
      items: pagedItems,
      total,
      page: normalized.page,
      pageSize: normalized.pageSize,
      generatedAt: now
    };

    this.cache.set(cacheKey, {
      expiresAt: now + this.cacheTtlMs,
      payload
    });

    this.logger.debug(
      `Directory cache refresh for ${cacheKey} → page=${normalized.page} pageSize=${normalized.pageSize} total=${total}`
    );

    return {
      ...payload,
      generatedAt: new Date(now),
      cacheHit: false
    };
  }

  private mergeWarehouseData(
    account: { accountAddress: string; profileUri: string | null; chainTimestamp: Date },
    positions: Map<string, { stakedAmount: bigint; updatedAt: Date | null }>,
    fees: Map<string, { feePerUnit: number; updatedAt: Date | null }>,
    profiles: Record<string, { name?: string; creditScore?: number; creditCapacity?: number; availability?: string; serviceAreas?: string[]; mediaSamples?: string[]; lastAuditAt?: string }>
  ): WarehouseComputed {
    const address = account.accountAddress.toLowerCase();
    const profile = profiles[address] ?? {};
    const position = positions.get(address);
    const fee = fees.get(address);

    const stakedAmount = position?.stakedAmount ?? 0n;
    const stakingScore = this.deriveScore(profile.creditScore, stakedAmount);
    const creditCapacity = this.deriveCreditCapacity(profile.creditCapacity, stakedAmount);
    const availability = this.resolveAvailability(profile.availability, stakedAmount);

    const name = this.resolveName(profile.name, account.profileUri, address);
    const mediaSamples = profile.mediaSamples && profile.mediaSamples.length > 0 ? profile.mediaSamples : undefined;
    const serviceAreas = profile.serviceAreas && profile.serviceAreas.length > 0 ? profile.serviceAreas : undefined;

    const lastAuditAt = profile.lastAuditAt ?? position?.updatedAt?.toISOString() ?? fee?.updatedAt?.toISOString();

    return {
      id: address,
      address,
      name,
      stakingScore,
      creditCapacity,
      insuranceCoverage: undefined,
      availability,
      mediaSamples,
      serviceAreas,
      lastAuditAt,
      feePerUnit: fee?.feePerUnit
    } satisfies WarehouseComputed;
  }

  private applyFilters(items: WarehouseComputed[], options: ReturnType<typeof this.normalizeOptions>): WarehouseComputed[] {
    return items.filter((item) => {
      if (options.q) {
        const q = options.q;
        const name = item.name?.toLowerCase() ?? '';
        const address = item.address?.toLowerCase?.() ?? '';
        const areas = (item.serviceAreas ?? []).map((a) => a.toLowerCase());
        const hit = name.includes(q) || address.includes(q) || areas.some((a) => a.includes(q));
        if (!hit) return false;
      }
      if (options.available && item.availability !== 'available') {
        return false;
      }
      if (typeof options.minScore === 'number' && item.stakingScore < options.minScore) {
        return false;
      }
      if (typeof options.maxFeeBps === 'number') {
        if (typeof item.feePerUnit === 'number' && item.feePerUnit > options.maxFeeBps) {
          return false;
        }
      }
      if (options.area) {
        if (!item.serviceAreas || !item.serviceAreas.some((area) => area.toLowerCase() === options.area)) {
          return false;
        }
      }
      return true;
    });
  }

  private applySort(items: WarehouseComputed[], sort: DirectorySort): WarehouseComputed[] {
    const sorted = [...items];
    switch (sort) {
      case 'fee_asc':
        sorted.sort((a, b) => this.compareNullableNumber(a.feePerUnit, b.feePerUnit, 'asc'));
        break;
      case 'capacity_desc':
        sorted.sort((a, b) => this.compareNullableNumber(a.creditCapacity, b.creditCapacity, 'desc'));
        break;
      case 'recent':
        sorted.sort((a, b) => (b.lastAuditAt ? Date.parse(b.lastAuditAt) : 0) - (a.lastAuditAt ? Date.parse(a.lastAuditAt) : 0));
        break;
      case 'score_desc':
      default:
        sorted.sort((a, b) => this.compareNullableNumber(a.stakingScore, b.stakingScore, 'desc'));
        break;
    }
    return sorted;
  }

  private compareNullableNumber(a: number | undefined, b: number | undefined, direction: 'asc' | 'desc'): number {
    const fallbackA = typeof a === 'number' ? a : direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const fallbackB = typeof b === 'number' ? b : direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    return direction === 'asc' ? fallbackA - fallbackB : fallbackB - fallbackA;
  }

  private resolveAvailability(candidate: string | undefined, stakedAmount: bigint): 'available' | 'limited' | 'maintenance' {
    if (candidate === 'available' || candidate === 'limited' || candidate === 'maintenance') {
      return candidate;
    }
    if (stakedAmount > 0n) {
      return 'available';
    }
    return 'limited';
  }

  private deriveScore(creditScore: number | undefined, stakedAmount: bigint): number {
    if (typeof creditScore === 'number' && Number.isFinite(creditScore)) {
      return creditScore;
    }
    const derived = Number(stakedAmount) / 1_000_000_000;
    return Number.isFinite(derived) ? Math.max(derived, 0) : 0;
  }

  private deriveCreditCapacity(creditCapacity: number | undefined, stakedAmount: bigint): number {
    if (typeof creditCapacity === 'number' && Number.isFinite(creditCapacity)) {
      return creditCapacity;
    }
    const derived = Number(stakedAmount) / 100_000_000;
    return Number.isFinite(derived) ? Math.max(derived, 0) : 0;
  }

  private resolveName(name: string | undefined, profileUri: string | null, address: string): string {
    if (name && name.trim()) {
      return name.trim();
    }
    if (profileUri && profileUri.trim()) {
      const parsed = this.extractNameFromProfileUri(profileUri);
      if (parsed) {
        return parsed;
      }
    }
    return `Warehouse ${address.slice(2, 8).toUpperCase()}`;
  }

  private extractNameFromProfileUri(uri: string): string | undefined {
    try {
      const trimmed = uri.trim();
      if (!trimmed) return undefined;
      if (/^https?:/i.test(trimmed)) {
        const url = new URL(trimmed);
        const label = url.searchParams.get('name');
        if (label) {
          return label;
        }
        const pathname = url.pathname.split('/').filter(Boolean);
        if (pathname.length) {
          return decodeURIComponent(pathname[pathname.length - 1]).replace(/[-_]/g, ' ');
        }
      }
      if (trimmed.includes(':') && !trimmed.startsWith('ipfs://')) {
        const parts = trimmed.split(':');
        return parts[parts.length - 1]?.replace(/[-_]/g, ' ');
      }
    } catch (error) {
      this.logger.debug(`Failed to parse profile URI ${uri}: ${this.stringifyError(error)}`);
    }
    return undefined;
  }

  private normalizeOptions(options: DirectoryListOptions) {
    const rawPage = Number.isFinite(options.page) ? Math.trunc(options.page) : 1;
    const rawPageSize = Number.isFinite(options.pageSize) ? Math.trunc(options.pageSize) : 20;
    return {
      available: options.available ?? false,
      minScore: typeof options.minScore === 'number' && Number.isFinite(options.minScore) ? options.minScore : undefined,
      maxFeeBps: typeof options.maxFeeBps === 'number' && Number.isFinite(options.maxFeeBps) ? options.maxFeeBps : undefined,
      area: options.area?.trim().toLowerCase() || undefined,
      q: options.q?.trim().toLowerCase() || undefined,
      sort: options.sort ?? 'score_desc',
      page: Math.max(rawPage, 1),
      pageSize: Math.max(Math.min(rawPageSize, 100), 1)
    } as const;
  }

  private resolvePositiveNumber(candidate: number, fallback: number): number {
    if (Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
    return fallback;
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
