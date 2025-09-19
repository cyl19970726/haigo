import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import { OrdersRepository } from './orders.repository.js';
import type { CreateOrderDraftDto, OrderDraftResponse } from './dto/create-order-draft.dto.js';
export declare class OrdersService {
    private readonly repo;
    constructor(repo: OrdersRepository);
    createDraft(dto: CreateOrderDraftDto): Promise<OrderDraftResponse>;
    listSummaries(filter?: {
        sellerAddress?: string;
    }): Promise<OrderSummaryDto[]>;
    getDetail(recordUid: string): Promise<OrderDetailDto | null>;
    applyOrderCreatedEvent(evt: {
        txnVersion: bigint;
        eventIndex: bigint;
        txnHash?: string | null;
        chainTimestamp?: Date | null;
        orderId: number;
        seller: string;
        warehouse: string;
        logisticsInbound?: string | null;
        pricing: {
            amount: number;
            insuranceFee: number;
            platformFee: number;
            total: number;
        };
    }): Promise<void>;
}
