import { BadRequestException, Injectable } from '@nestjs/common';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import {
  ORDER_MEDIA_ACCEPTED_MIME,
  ORDER_MEDIA_ERROR_CODES,
  ORDER_MEDIA_HASH_ALGORITHMS,
  ORDER_MEDIA_STAGES,
  ORDER_MEDIA_VERIFICATION_STATUSES
} from '@haigo/shared/config/orders';
import type { OrderMediaAsset, OrderMediaHashAlgorithm, OrderMediaStage } from '@haigo/shared/dto/orders';
import type { Express } from 'express';
import { NormalizedUploadMediaBody, RawUploadMediaBody } from './dto/upload-media.dto.js';
import { MediaRepository } from './media.repository.js';
import { MediaStorageService } from './media.storage.js';

const ORDER_MEDIA_ACCEPTED_SET = new Set(
  Object.values(ORDER_MEDIA_ACCEPTED_MIME)
    .flatMap((items) => Array.from(items, (item) => item.toLowerCase()))
);

const HASH_ALGO_LABELS: Record<string, OrderMediaHashAlgorithm> = {
  BLAKE3: ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3,
  blake3: ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3,
  KECCAK256: ORDER_MEDIA_HASH_ALGORITHMS.KECCAK256,
  keccak256: ORDER_MEDIA_HASH_ALGORITHMS.KECCAK256
};

@Injectable()
export class MediaService {
  constructor(private readonly storage: MediaStorageService, private readonly repository: MediaRepository) {}

  async handleUpload(
    file: Express.Multer.File | undefined,
    rawBody: RawUploadMediaBody
  ): Promise<
    OrderMediaAsset & {
      recordUid: string;
      path: string;
      hash: { algo: string; value: string };
    }
  > {

    if (!file) {
      throw new BadRequestException('Upload file is required');
    }

    const body = this.normalizeBody(rawBody);
    if (!body.recordUid) {
      throw new BadRequestException('record_uid is required');
    }

    const normalizedHashAlgorithm = this.normalizeHashAlgorithm(body.hashAlgorithm);
    if (body.hashAlgorithm && !normalizedHashAlgorithm) {
      throw new BadRequestException('Unsupported hash algorithm');
    }

    const normalizedStage = this.normalizeStage(body.stage);
    const normalizedCategory = body.category ? body.category.toLowerCase() : undefined;

    this.assertFileAllowed(file);

    const computedHash = this.computeBlake3(file.buffer);

    if (body.hashValue) {
      const normalizedExpected = this.normalizeHash(body.hashValue);
      if (computedHash !== normalizedExpected) {
        throw new BadRequestException({
          message: 'Hash mismatch between client and server',
          code: ORDER_MEDIA_ERROR_CODES.HASH_MISMATCH
        });
      }
    }

    const stored = await this.storage.save({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      recordUid: body.recordUid,
      stage: normalizedStage,
      category: normalizedCategory
    });

    const stage = normalizedStage ?? ORDER_MEDIA_STAGES.INBOUND;
    const category = normalizedCategory ?? this.resolveCategory(file.mimetype);
    const uploadedAt = new Date();

    await this.repository.recordUpload({
      recordUid: body.recordUid,
      stage,
      category,
      storagePath: stored.storagePath,
      publicPath: stored.publicPath,
      hashAlgo: ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3,
      hashValue: computedHash,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: body.address,
      uploadedAt
    });

    return {
      recordUid: body.recordUid,
      stage,
      category,
      hashAlgorithm: normalizedHashAlgorithm ?? ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3,
      hashValue: computedHash,
      crossCheckHashAlgorithm: body.crossCheckHashAlgorithm
        ? this.normalizeHashAlgorithm(body.crossCheckHashAlgorithm)
        : undefined,
      crossCheckHashValue: body.crossCheckHashValue ? this.normalizeHash(body.crossCheckHashValue) : undefined,
      sizeBytes: file.size,
      mimeType: file.mimetype,
      storagePath: stored.storagePath,
      path: stored.publicPath,
      uploadedBy: body.address,
      uploadedAt: uploadedAt.toISOString(),
      matchedOffchain: false,
      verificationStatus: ORDER_MEDIA_VERIFICATION_STATUSES.PENDING,
      hash: {
        algo: ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3,
        value: computedHash
      }
    };
  }


  private normalizeBody(body: RawUploadMediaBody): NormalizedUploadMediaBody {
    const recordUid = (body.record_uid || body.recordUid || body.address || '').trim();
    const hashAlgorithmRaw = (body.hash_algorithm || body.hash_algo || '').trim();
    const hashValueRaw = (body.hash_value || body.hash || '').trim();
    const sizeBytes = body.size_bytes ? Number(body.size_bytes) : undefined;
    const mimeType = body.mime_type ? body.mime_type.trim() : undefined;

    return {
      recordUid,
      stage: body.stage?.trim(),
      category: body.category?.trim(),
      hashAlgorithm: hashAlgorithmRaw || undefined,
      hashValue: hashValueRaw || undefined,
      crossCheckHashAlgorithm: body.cross_check_hash_algorithm?.trim(),
      crossCheckHashValue: body.cross_check_hash_value?.trim(),
      sizeBytes: Number.isFinite(sizeBytes as number) ? (sizeBytes as number) : undefined,
      mimeType,
      address: body.address?.trim(),
      role: body.role?.trim()
    };
  }

  private normalizeStage(stage?: string): OrderMediaStage | undefined {
    if (!stage) return undefined;
    const normalized = stage.trim().toLowerCase();
    const allowed = Object.values(ORDER_MEDIA_STAGES) as OrderMediaStage[];
    if ((allowed as string[]).includes(normalized)) {
      return normalized as OrderMediaStage;
    }
    return undefined;
  }

  private normalizeHashAlgorithm(value?: string): OrderMediaHashAlgorithm | undefined {
    if (!value) return undefined;
    const direct = HASH_ALGO_LABELS[value];
    if (direct) {
      return direct;
    }
    return HASH_ALGO_LABELS[value.toUpperCase()];
  }

  private computeBlake3(buffer: Buffer): string {
    return bytesToHex(blake3(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))).toLowerCase();
  }

  private normalizeHash(value: string): string {
    return value.replace(/^0x/, '').toLowerCase();
  }

  private assertFileAllowed(file: Express.Multer.File): void {
    const mime = file.mimetype?.toLowerCase();
    if (!mime || !ORDER_MEDIA_ACCEPTED_SET.has(mime)) {
      throw new BadRequestException({
        message: `Unsupported media type: ${file.mimetype || 'unknown'}`,
        code: ORDER_MEDIA_ERROR_CODES.MIME_NOT_ALLOWED
      });
    }
  }

  private resolveCategory(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (
      (ORDER_MEDIA_ACCEPTED_MIME.IMAGE as readonly string[])
        .map((item: string) => item.toLowerCase())
        .includes(normalized)
    ) {
      return 'inbound_photo';
    }
    if (
      (ORDER_MEDIA_ACCEPTED_MIME.VIDEO as readonly string[])
        .map((item: string) => item.toLowerCase())
        .includes(normalized)
    ) {
      return 'inbound_video';
    }
    return 'inbound_document';
  }
}
