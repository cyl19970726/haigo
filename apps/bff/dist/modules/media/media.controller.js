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
import { Body, Controller, Post, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { MediaService } from './media.service.js';
let MediaController = class MediaController {
    constructor(mediaService) {
        this.mediaService = mediaService;
    }
    async uploadMedia(files, body, req, res) {
        const { requestId, timestamp, traceId } = this.createResponseMeta(req);
        res.setHeader('x-haigo-trace-id', traceId);
        const file = files.file?.[0] ?? files.media?.[0];
        const asset = await this.mediaService.handleUpload(file, body);
        res.status(201);
        return {
            data: asset,
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
    Post('uploads'),
    UseInterceptors(FileFieldsInterceptor([
        { name: 'file', maxCount: 1 },
        { name: 'media', maxCount: 1 }
    ], {
        storage: memoryStorage(),
        limits: {
            fileSize: 200 * 1024 * 1024
        }
    })),
    __param(0, UploadedFiles()),
    __param(1, Body()),
    __param(2, Req()),
    __param(3, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MediaController.prototype, "uploadMedia", null);
MediaController = __decorate([
    Controller('api/media'),
    __metadata("design:paramtypes", [MediaService])
], MediaController);
export { MediaController };
