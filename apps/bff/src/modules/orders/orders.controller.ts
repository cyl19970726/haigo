import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import { OrdersService } from './orders.service.js';
import { CreateOrderDraftDto, type OrderDraftResponse } from './dto/create-order-draft.dto.js';

@Controller('/api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('drafts')
  async createDraft(@Body() dto: CreateOrderDraftDto): Promise<OrderDraftResponse> {
    // Basic address format checks (PoC). Advanced signature/nonce gating to be added later.
    if (!/^0x[0-9a-fA-F]+$/.test(dto.sellerAddress) || !/^0x[0-9a-fA-F]+$/.test(dto.warehouseAddress)) {
      throw new NotFoundException('Invalid address format');
    }
    return this.orders.createDraft(dto);
  }

  @Get()
  async list(@Query('seller') seller?: string): Promise<OrderSummaryDto[]> {
    return this.orders.listSummaries({ sellerAddress: seller });
  }

  @Get(':recordUid')
  async detail(@Param('recordUid') recordUid: string): Promise<OrderDetailDto> {
    const detail = await this.orders.getDetail(recordUid);
    if (!detail) throw new NotFoundException('Order not found');
    return detail;
  }
}

