var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { CreateOrderDraftDto } from './dto/create-order-draft.dto.js';
let OrdersController = class OrdersController {
    constructor(orders) {
        this.orders = orders;
    }
    async createDraft(dto) {
        // Basic address format checks (PoC). Advanced signature/nonce gating to be added later.
        if (!/^0x[0-9a-fA-F]+$/.test(dto.sellerAddress) || !/^0x[0-9a-fA-F]+$/.test(dto.warehouseAddress)) {
            throw new NotFoundException('Invalid address format');
        }
        return this.orders.createDraft(dto);
    }
    async list(seller) {
        return this.orders.listSummaries({ sellerAddress: seller });
    }
    async detail(recordUid) {
        const detail = await this.orders.getDetail(recordUid);
        if (!detail)
            throw new NotFoundException('Order not found');
        return detail;
    }
};
__decorate([
    Post('drafts'),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateOrderDraftDto]),
    __metadata("design:returntype", Promise)
], OrdersController.prototype, "createDraft", null);
__decorate([
    Get(),
    __param(0, Query('seller')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], OrdersController.prototype, "list", null);
__decorate([
    Get(':recordUid'),
    __param(0, Param('recordUid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], OrdersController.prototype, "detail", null);
OrdersController = __decorate([
    Controller('/api/orders'),
    __metadata("design:paramtypes", [OrdersService])
], OrdersController);
export { OrdersController };
