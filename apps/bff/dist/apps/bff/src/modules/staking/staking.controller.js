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
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { StakingService } from './staking.service.js';
let StakingController = class StakingController {
    constructor(service) {
        this.service = service;
    }
    async getOwnIntent() {
        // 在 PoC 阶段，要求客户端传递地址；如需“当前用户”语义，可从 auth 中提取
        throw new NotFoundException('Address is required: use /api/staking/:warehouseAddress');
    }
    async getIntent(warehouseAddress) {
        const result = await this.service.getIntent(warehouseAddress);
        if (!result)
            throw new NotFoundException('Staking intent not found');
        return { data: result.data, meta: { source: result.meta.source } };
    }
};
__decorate([
    Get('/intent'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StakingController.prototype, "getOwnIntent", null);
__decorate([
    Get('/:warehouseAddress'),
    __param(0, Param('warehouseAddress')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], StakingController.prototype, "getIntent", null);
StakingController = __decorate([
    Controller('/api/staking'),
    __metadata("design:paramtypes", [StakingService])
], StakingController);
export { StakingController };
