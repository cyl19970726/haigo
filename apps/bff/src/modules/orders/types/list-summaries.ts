import type { OrderSummaryDto } from '@haigo/shared/dto/orders';

export interface ListSummariesOptions {
  sellerAddress?: string;
  warehouseAddress?: string;
  status?: OrderSummaryDto['status'];
  page?: number;
  pageSize?: number;
}

export interface ListSummariesResult {
  items: OrderSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
}
