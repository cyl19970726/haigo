import { Controller, Get, Query } from '@nestjs/common';
import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import { DirectoryService } from './directory.service.js';

interface ListQuery {
  available?: string;
  minScore?: string;
  maxFeeBps?: string;
  area?: string;
  q?: string;
  sort?: 'score_desc' | 'fee_asc' | 'capacity_desc' | 'recent';
  page?: string;
  pageSize?: string;
}

@Controller('/api/warehouses')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  async list(
    @Query() query: ListQuery
  ): Promise<{ data: WarehouseSummary[]; meta: { page: number; pageSize: number; total: number; generatedAt: string; cacheHit: boolean } }> {
    const page = this.parseInteger(query.page, 1);
    const pageSize = this.parseInteger(query.pageSize, 20, { min: 1, max: 100 });

    const result = await this.directory.list({
      available: query.available === 'true' ? true : query.available === 'false' ? false : undefined,
      minScore: this.parseNumber(query.minScore),
      maxFeeBps: this.parseNumber(query.maxFeeBps),
      area: query.area,
      q: query.q,
      sort: query.sort,
      page,
      pageSize
    });

    return {
      data: result.items,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        generatedAt: result.generatedAt.toISOString(),
        cacheHit: result.cacheHit
      }
    };
  }

  private parseInteger(value: string | undefined, fallback: number, bounds?: { min?: number; max?: number }): number {
    const parsed = Number.parseInt(`${value ?? ''}`, 10);
    let resolved = Number.isFinite(parsed) ? parsed : fallback;
    if (bounds?.min !== undefined) {
      resolved = Math.max(resolved, bounds.min);
    }
    if (bounds?.max !== undefined) {
      resolved = Math.min(resolved, bounds.max);
    }
    return resolved;
  }

  private parseNumber(value: string | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
