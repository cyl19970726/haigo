import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import { OrdersService } from './orders.service.js';
import { CreateOrderDraftDto, type OrderDraftResponse } from './dto/create-order-draft.dto.js';
export declare class OrdersController {
    private readonly orders;
    constructor(orders: OrdersService);
    createDraft(dto: CreateOrderDraftDto): Promise<OrderDraftResponse>;
    list(seller?: string): Promise<OrderSummaryDto[]>;
    detail(recordUid: string): Promise<OrderDetailDto>;
}
