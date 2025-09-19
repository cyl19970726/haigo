import { Injectable, Logger } from '@nestjs/common';
import type { WarehouseSummary } from '@haigo/shared/dto/orders';
import { MetricsService } from '../metrics/metrics.service.js';
import { DirectoryRepository, type DirectoryListOptions, type DirectoryListResult } from './directory.repository.js';

export interface DirectoryListResponse {
  items: WarehouseSummary[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: Date;
  cacheHit: boolean;
}

@Injectable()
export class DirectoryService {
  private readonly logger = new Logger(DirectoryService.name);

  constructor(private readonly repo: DirectoryRepository, private readonly metrics: MetricsService) {}

  async list(options: DirectoryListOptions): Promise<DirectoryListResponse> {
    const start = Date.now();
    try {
      const result = await this.repo.list(options);
      this.metrics.recordDirectoryRequest({
        cacheHit: result.cacheHit,
        latencyMs: Date.now() - start
      });
      return result satisfies DirectoryListResponse;
    } catch (error) {
      this.metrics.recordDirectoryError();
      this.logger.error(`Directory lookup failed: ${this.stringifyError(error)}`);
      throw error;
    }
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
