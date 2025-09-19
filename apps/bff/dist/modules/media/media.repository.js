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
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
let MediaRepository = class MediaRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async recordUpload(input) {
        const data = {
            recordUid: input.recordUid,
            stage: input.stage,
            category: input.category,
            storagePath: input.storagePath,
            publicPath: input.publicPath ?? null,
            hashAlgo: input.hashAlgo,
            hashValue: input.hashValue,
            mimeType: input.mimeType ?? null,
            sizeBytes: input.sizeBytes ?? null,
            uploadedBy: input.uploadedBy ?? null,
            uploadedAt: input.uploadedAt,
            matchedOffchain: false
        };
        await this.prisma.mediaAsset.create({ data });
    }
};
MediaRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], MediaRepository);
export { MediaRepository };
