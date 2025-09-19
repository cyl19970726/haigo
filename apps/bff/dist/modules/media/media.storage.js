var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MediaStorageService_1;
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
let MediaStorageService = MediaStorageService_1 = class MediaStorageService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new Logger(MediaStorageService_1.name);
        const configuredRoot = this.configService.get('media.storageDir');
        this.storageRoot = configuredRoot ? path.resolve(configuredRoot) : path.resolve(process.cwd(), 'storage', 'media');
        const configuredPrefix = this.configService.get('media.publicPrefix');
        this.publicPrefix = configuredPrefix ? this.ensureLeadingSlash(configuredPrefix) : '/media';
    }
    async save(options) {
        const recordSegment = this.sanitizeSegment(options.recordUid, 'recordUid');
        const stageSegment = options.stage ? this.sanitizeSegment(options.stage, 'stage') : 'default';
        const categorySegment = options.category ? this.sanitizeSegment(options.category, 'category') : undefined;
        const targetDir = categorySegment
            ? path.join(this.storageRoot, recordSegment, stageSegment, categorySegment)
            : path.join(this.storageRoot, recordSegment, stageSegment);
        await fs.mkdir(targetDir, { recursive: true });
        const extension = this.resolveExtension(options.originalName, options.mimeType);
        const filename = `${Date.now()}-${randomUUID()}${extension}`;
        const absolutePath = path.join(targetDir, filename);
        await fs.writeFile(absolutePath, options.buffer);
        const storagePathSegments = [recordSegment, stageSegment];
        if (categorySegment) {
            storagePathSegments.push(categorySegment);
        }
        storagePathSegments.push(filename);
        const storagePath = storagePathSegments.join('/');
        const publicPath = this.buildPublicPath(storagePathSegments);
        this.logger.debug?.(`Stored media object at ${absolutePath}`);
        return {
            absolutePath,
            storagePath,
            publicPath,
            filename
        };
    }
    sanitizeSegment(value, field) {
        const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
        if (!normalized) {
            throw new Error(`Invalid ${field} value`);
        }
        return normalized;
    }
    resolveExtension(originalName, mimeType) {
        const fallback = path.extname(originalName);
        if (fallback) {
            return fallback;
        }
        switch (mimeType.toLowerCase()) {
            case 'image/jpeg':
                return '.jpg';
            case 'image/png':
                return '.png';
            case 'image/webp':
                return '.webp';
            case 'image/heic':
                return '.heic';
            case 'application/pdf':
                return '.pdf';
            case 'video/mp4':
                return '.mp4';
            case 'video/quicktime':
                return '.mov';
            default:
                return '.bin';
        }
    }
    buildPublicPath(segments) {
        const normalizedPrefix = this.publicPrefix.endsWith('/') ? this.publicPrefix.slice(0, -1) : this.publicPrefix;
        return `${normalizedPrefix}/${segments.join('/')}`;
    }
    ensureLeadingSlash(value) {
        if (!value.startsWith('/')) {
            return `/${value}`;
        }
        return value;
    }
};
MediaStorageService = MediaStorageService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService])
], MediaStorageService);
export { MediaStorageService };
