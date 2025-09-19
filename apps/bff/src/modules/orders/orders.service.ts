import { Injectable } from '@nestjs/common';
import { ORDERS_MODULE_ADDRESS, ORDERS_MODULE_NAME, APTOS_COIN_TYPE } from '@haigo/shared/config/aptos';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import { OrdersRepository } from './orders.repository.js';
import type { CreateOrderDraftDto, OrderDraftResponse } from './dto/create-order-draft.dto.js';

@Injectable()
export class OrdersService {
  constructor(private readonly repo: OrdersRepository) {}

  async createDraft(dto: CreateOrderDraftDto): Promise<OrderDraftResponse> {
    const recordUid = await this.repo.createDraft(dto);
    return {
      recordUid,
      signPayload: {
        function: `${ORDERS_MODULE_ADDRESS}::${ORDERS_MODULE_NAME}::create_order`,
        typeArguments: [APTOS_COIN_TYPE],
        functionArguments: [
          dto.warehouseAddress,
          dto.inboundLogistics ?? null,
          String(dto.pricing.amountSubunits),
          String(dto.pricing.insuranceFeeSubunits),
          String(dto.pricing.platformFeeSubunits),
          dto.initialMedia?.category ?? null,
          dto.initialMedia?.hashValue ? Array.from(Buffer.from(dto.initialMedia.hashValue, 'hex')) : null
        ]
      }
    };
  }

  async listSummaries(filter?: { sellerAddress?: string }): Promise<OrderSummaryDto[]> {
    return this.repo.listSummaries(filter);
  }

  async getDetail(recordUid: string): Promise<OrderDetailDto | null> {
    return this.repo.getDetail(recordUid);
  }

  async applyOrderCreatedEvent(evt: {
    txnVersion: bigint;
    eventIndex: bigint;
    txnHash?: string | null;
    chainTimestamp?: Date | null;
    orderId: number;
    seller: string;
    warehouse: string;
    logisticsInbound?: string | null;
    pricing: { amount: number; insuranceFee: number; platformFee: number; total: number };
  }): Promise<void> {
    await this.repo.upsertOnchainCreated(evt);
  }
}

