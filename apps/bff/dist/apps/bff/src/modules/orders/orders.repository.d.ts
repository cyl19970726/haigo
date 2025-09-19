import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { OrderDetailDto, OrderSummaryDto } from '@haigo/shared/dto/orders';
import type { CreateOrderDraftDto } from './dto/create-order-draft.dto.js';
export declare class OrdersRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createDraft(dto: CreateOrderDraftDto): Promise<string>;
    upsertOnchainCreated(evt: {
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
    listSummaries(filter?: {
        sellerAddress?: string;
    }): Promise<OrderSummaryDto[]>;
    getDetail(recordUid: string): Promise<OrderDetailDto | null>;
}
