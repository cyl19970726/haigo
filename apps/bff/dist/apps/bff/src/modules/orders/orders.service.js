var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { ORDERS_MODULE_ADDRESS, ORDERS_MODULE_NAME, APTOS_COIN_TYPE } from '@haigo/shared/config/aptos';
import { OrdersRepository } from './orders.repository.js';
let OrdersService = class OrdersService {
    constructor(repo) {
        this.repo = repo;
    }
    async createDraft(dto) {
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
    async listSummaries(filter) {
        return this.repo.listSummaries(filter);
    }
    async getDetail(recordUid) {
        return this.repo.getDetail(recordUid);
    }
    async applyOrderCreatedEvent(evt) {
        await this.repo.upsertOnchainCreated(evt);
    }
};
OrdersService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [OrdersRepository])
], OrdersService);
export { OrdersService };
