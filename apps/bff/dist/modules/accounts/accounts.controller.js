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
import { BadRequestException, Controller, Get, Param, Post, UploadedFile, UseInterceptors, Res, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { memoryStorage } from 'multer';
import { AccountsService } from './accounts.service.js';
let AccountsController = class AccountsController {
    constructor(accountsService) {
        this.accountsService = accountsService;
    }
    async getAccountProfile(address, req, res) {
        const { requestId, timestamp, traceId } = this.createResponseMeta(req);
        res.setHeader('x-haigo-trace-id', traceId);
        const profile = await this.accountsService.getAccountProfile(address);
        return {
            data: profile,
            meta: this.buildMeta(requestId, timestamp)
        };
    }
    async verifyAccountHash(address, file, req, res) {
        if (!file) {
            throw new BadRequestException('Verification file is required');
        }
        const { requestId, timestamp, traceId } = this.createResponseMeta(req);
        res.setHeader('x-haigo-trace-id', traceId);
        const result = await this.accountsService.verifyProfileHash(address, file);
        return {
            data: {
                address: address.toLowerCase(),
                verified: result.verified,
                computedHash: result.computedHash,
                storedHash: result.storedHash,
                checkedAt: new Date().toISOString()
            },
            meta: this.buildMeta(requestId, timestamp)
        };
    }
    createResponseMeta(req) {
        const requestId = randomUUID();
        const timestamp = new Date().toISOString();
        const traceId = req.headers['x-haigo-trace-id'] || requestId;
        return { requestId, timestamp, traceId };
    }
    buildMeta(requestId, timestamp) {
        return {
            requestId,
            timestamp
        };
    }
};
__decorate([
    Get(':address'),
    __param(0, Param('address')),
    __param(1, Req()),
    __param(2, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "getAccountProfile", null);
__decorate([
    Post(':address/verify-hash'),
    UseInterceptors(FileInterceptor('file', {
        storage: memoryStorage(),
        limits: {
            fileSize: 15 * 1024 * 1024
        }
    })),
    __param(0, Param('address')),
    __param(1, UploadedFile()),
    __param(2, Req()),
    __param(3, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AccountsController.prototype, "verifyAccountHash", null);
AccountsController = __decorate([
    Controller('api/accounts'),
    __metadata("design:paramtypes", [AccountsService])
], AccountsController);
export { AccountsController };
