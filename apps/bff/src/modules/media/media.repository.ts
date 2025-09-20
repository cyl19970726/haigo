import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export interface CreateMediaAssetInput {
  recordUid: string;
  stage: string;
  category: string;
  storagePath: string;
  publicPath?: string;
  hashAlgo: string;
  hashValue: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedBy?: string;
  uploadedAt: Date;
}

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async recordUpload(input: CreateMediaAssetInput): Promise<void> {
    const data: Prisma.MediaAssetCreateInput = {
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
}
