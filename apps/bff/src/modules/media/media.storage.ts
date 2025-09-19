import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

interface SaveMediaOptions {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  recordUid: string;
  stage?: string;
  category?: string;
}

export interface StoredMediaObject {
  absolutePath: string;
  storagePath: string;
  publicPath: string;
  filename: string;
}

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly storageRoot: string;
  private readonly publicPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const configuredRoot = this.configService.get<string>('media.storageDir');
    this.storageRoot = configuredRoot ? path.resolve(configuredRoot) : path.resolve(process.cwd(), 'storage', 'media');
    const configuredPrefix = this.configService.get<string>('media.publicPrefix');
    this.publicPrefix = configuredPrefix ? this.ensureLeadingSlash(configuredPrefix) : '/media';
  }

  async save(options: SaveMediaOptions): Promise<StoredMediaObject> {
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

  private sanitizeSegment(value: string, field: string): string {
    const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    if (!normalized) {
      throw new Error(`Invalid ${field} value`);
    }
    return normalized;
  }

  private resolveExtension(originalName: string, mimeType: string): string {
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

  private buildPublicPath(segments: string[]): string {
    const normalizedPrefix = this.publicPrefix.endsWith('/') ? this.publicPrefix.slice(0, -1) : this.publicPrefix;
    return `${normalizedPrefix}/${segments.join('/')}`;
  }

  private ensureLeadingSlash(value: string): string {
    if (!value.startsWith('/')) {
      return `/${value}`;
    }
    return value;
  }
}
