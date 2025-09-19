import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query
} from '@nestjs/common';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import { OrdersService } from './orders.service.js';
import { CreateOrderDraftDto, type OrderDraftResponse } from './dto/create-order-draft.dto.js';
import { AttachTxDto } from './dto/attach-tx.dto.js';
import { MetricsService } from '../metrics/metrics.service.js';

interface OrdersListQuery {
  seller?: string;
  warehouse?: string;
  status?: string;
  page?: string;
  pageSize?: string;
}

interface OrdersListMeta {
  page: number;
  pageSize: number;
  total: number;
  generatedAt: string;
  filters: {
    sellerAddress?: string;
    warehouseAddress?: string;
    status?: OrderSummaryDto['status'];
  };
}

interface OrdersListResponse {
  data: OrderSummaryDto[];
  meta: OrdersListMeta;
}

const ADDRESS_REGEX = /^0x[0-9a-fA-F]+$/;
const ALLOWED_STATUSES = new Set<OrderSummaryDto['status']>([
  'PENDING',
  'CREATED',
  'WAREHOUSE_IN',
  'IN_STORAGE',
  'WAREHOUSE_OUT'
]);

@Controller('/api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService, private readonly metrics: MetricsService) {}

  @Post('drafts')
  async createDraft(@Body() dto: CreateOrderDraftDto): Promise<OrderDraftResponse> {
    // Basic address format checks (PoC). Advanced signature/nonce gating to be added later.
    if (!/^0x[0-9a-fA-F]+$/.test(dto.sellerAddress) || !/^0x[0-9a-fA-F]+$/.test(dto.warehouseAddress)) {
      throw new NotFoundException('Invalid address format');
    }
    return this.orders.createDraft(dto);
  }

  @Get()
  async list(@Query() query: OrdersListQuery): Promise<OrdersListResponse> {
    const filters = this.parseListQuery(query);
    const startedAt = Date.now();
    try {
      const result = await this.orders.listSummaries(filters);
      this.metrics.recordOrdersInboxRequest({ latencyMs: Date.now() - startedAt });
      return {
        data: result.items,
        meta: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          generatedAt: new Date().toISOString(),
          filters: {
            sellerAddress: filters.sellerAddress,
            warehouseAddress: filters.warehouseAddress,
            status: filters.status
          }
        }
      };
    } catch (error) {
      this.metrics.recordOrdersInboxError();
      throw error;
    }
  }

  @Get(':recordUid')
  async detail(@Param('recordUid') recordUid: string): Promise<OrderDetailDto> {
    const detail = await this.orders.getDetail(recordUid);
    if (!detail) throw new NotFoundException('Order not found');
    return detail;
  }

  @Post('drafts/:recordUid/attach-tx')
  async attachTx(@Param('recordUid') recordUid: string, @Body() dto: AttachTxDto): Promise<{ ok: true }>
  {
    if (!dto?.txnHash || typeof dto.txnHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(dto.txnHash)) {
      throw new NotFoundException('Invalid txn hash');
    }
    await this.orders.attachDraftTransaction(recordUid, dto.txnHash);
    return { ok: true };
  }

  private parseListQuery(query: OrdersListQuery) {
    const seller = this.normalizeAddress(query.seller);
    const warehouse = this.normalizeAddress(query.warehouse);
    if (seller && warehouse) {
      throw new BadRequestException('Specify either seller or warehouse address, not both');
    }

    const status = this.normalizeStatus(query.status);
    const page = this.parseInteger(query.page, 1, { min: 1 });
    const pageSize = this.parseInteger(query.pageSize, 20, { min: 1, max: 100 });

    return {
      sellerAddress: seller ?? undefined,
      warehouseAddress: warehouse ?? undefined,
      status: status ?? undefined,
      page,
      pageSize
    };
  }

  private normalizeAddress(value?: string | null): string | null {
    if (!value) {
      return null;
    }
    if (!ADDRESS_REGEX.test(value)) {
      throw new BadRequestException('Invalid address format');
    }
    return value.toLowerCase();
  }

  private normalizeStatus(value?: string | null): OrderSummaryDto['status'] | null {
    if (!value) {
      return null;
    }
    const normalized = value.toUpperCase() as OrderSummaryDto['status'];
    if (!ALLOWED_STATUSES.has(normalized)) {
      throw new BadRequestException('Unsupported status filter');
    }
    return normalized;
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
}
