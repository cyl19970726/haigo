import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { ORDER_MEDIA_ERROR_CODES, ORDER_MEDIA_STAGES } from '@haigo/shared/config/orders';
import type { Express } from 'express';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MediaService } from '../src/modules/media/media.service.js';
import { MediaStorageService } from '../src/modules/media/media.storage.js';
import type { MediaRepository } from '../src/modules/media/media.repository.js';

const createTempDir = () => mkdtempSync(path.join(os.tmpdir(), 'haigo-media-'));

const computeHash = (buffer: Buffer) => bytesToHex(blake3(buffer)).toLowerCase();

describe('MediaService', () => {
  let service: MediaService;
  let tempDir: string;
  let repository: MediaRepository;
  let recordUploadMock: jest.Mock;

  const buildConfigStub = (storageDir: string) => ({
    get: jest.fn((key: string, defaultValue?: unknown) => {
      switch (key) {
        case 'media.storageDir':
          return storageDir;
        case 'media.publicPrefix':
          return '/media';
        default:
          return defaultValue;
      }
    })
  }) as unknown as ConfigService;

  beforeEach(() => {
    tempDir = createTempDir();
    const storage = new MediaStorageService(buildConfigStub(tempDir));
    recordUploadMock = jest.fn().mockResolvedValue(undefined);
    repository = {
      recordUpload: recordUploadMock
    } as unknown as MediaRepository;
    service = new MediaService(storage, repository);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const buildFile = (content: string, mimeType: string, originalName: string): Express.Multer.File => {
    const buffer = Buffer.from(content);
    return {
      buffer,
      mimetype: mimeType,
      originalname: originalName,
      size: buffer.length,
      fieldname: 'file',
      stream: undefined as any,
      destination: undefined as any,
      encoding: '7bit',
      filename: originalName,
      path: undefined as any
    };
  };

  it('stores media and returns metadata when hash matches', async () => {
    const file = buildFile('media-service-test', 'image/jpeg', 'evidence.jpg');
    const expectedHash = computeHash(file.buffer);

    const result = await service.handleUpload(file, {
      record_uid: 'HG-2024-0001',
      stage: ORDER_MEDIA_STAGES.INBOUND,
      category: 'inbound_photo',
      hash_value: expectedHash
    });

    expect(recordUploadMock).toHaveBeenCalledWith({
      recordUid: 'HG-2024-0001',
      stage: ORDER_MEDIA_STAGES.INBOUND,
      category: 'inbound_photo',
      storagePath: expect.any(String),
      publicPath: expect.any(String),
      hashAlgo: 'BLAKE3',
      hashValue: expectedHash,
      mimeType: 'image/jpeg',
      sizeBytes: file.size,
      uploadedBy: undefined,
      uploadedAt: expect.any(Date)
    });

    expect(result.recordUid).toBe('HG-2024-0001');
    expect(result.hashValue).toBe(expectedHash);
    expect(result.stage).toBe(ORDER_MEDIA_STAGES.INBOUND);
    expect(result.storagePath).toBeDefined();
    expect(result.storagePath).toContain('hg-2024-0001');
    expect(result.path).toMatch(/\/media\//);
    expect(result.mimeType).toBe('image/jpeg');

    const storedFilePath = path.join(tempDir, result.storagePath!);
    await expect(fs.stat(storedFilePath)).resolves.toMatchObject({ size: file.size });
  });

  it('throws when hash mismatch occurs', async () => {
    const file = buildFile('media-service-test', 'image/jpeg', 'mismatch.jpg');

    await expect(
      service.handleUpload(file, {
        record_uid: 'HG-2024-0002',
        stage: ORDER_MEDIA_STAGES.INBOUND,
        category: 'inbound_photo',
        hash_value: 'deadbeef'
      })
    ).rejects.toMatchObject({
      response: {
        code: ORDER_MEDIA_ERROR_CODES.HASH_MISMATCH
      }
    });

    expect(recordUploadMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported mime types', async () => {
    const file = buildFile('plain-text', 'text/plain', 'note.txt');

    await expect(
      service.handleUpload(file, {
        record_uid: 'HG-2024-0003',
        stage: ORDER_MEDIA_STAGES.INBOUND,
        category: 'inbound_photo',
        hash_value: computeHash(file.buffer)
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(recordUploadMock).not.toHaveBeenCalled();
  });
});
