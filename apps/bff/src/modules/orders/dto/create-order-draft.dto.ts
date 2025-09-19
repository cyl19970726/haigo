export class CreateOrderDraftDto {
  sellerAddress!: string;
  warehouseAddress!: string;
  inboundLogistics?: string | null;
  pricing!: {
    amountSubunits: number;
    insuranceFeeSubunits: number;
    platformFeeSubunits: number;
    currency: 'APT';
  };
  initialMedia?: { category: string; hashValue: string } | null;
}

export interface OrderDraftResponse {
  recordUid: string;
  signPayload: {
    function: `${string}::${string}::${string}`;
    typeArguments: string[];
    functionArguments: any[];
  };
}

