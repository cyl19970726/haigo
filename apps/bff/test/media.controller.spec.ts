import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MediaController } from '../src/modules/media/media.controller.js';
import { MediaRepository } from '../src/modules/media/media.repository.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { MediaStorageService } from '../src/modules/media/media.storage.js';

const computeHash = (buffer: Buffer) => bytesToHex(blake3(buffer)).toLowerCase();

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

describe('MediaController', () => {
  let app: INestApplication;
  let tempDir: string;
  let recordUploadMock: jest.Mock;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'haigo-media-'));
    recordUploadMock = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        MediaService,
        MediaStorageService,
        MediaRepository,
        { provide: ConfigService, useValue: buildConfigStub(tempDir) }
      ]
    })
      .overrideProvider(MediaRepository)
      .useValue({ recordUpload: recordUploadMock })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    recordUploadMock.mockClear();
  });

  it('accepts uploads via `file` field and returns metadata envelope', async () => {
    const buffer = Buffer.from('media-controller-file');
    const hashValue = computeHash(buffer);

    const response = await request(app.getHttpServer())
      .post('/api/media/uploads')
      .field('record_uid', 'HG-2024-0009')
      .field('stage', 'inbound')
      .field('category', 'inbound_photo')
      .field('hash_value', hashValue)
      .attach('file', buffer, { filename: 'evidence.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(response.body.data.hashValue).toBe(hashValue);
    expect(response.body.data.path).toMatch(/\/media\/hg-2024-0009/);
    expect(response.body.meta.requestId).toBeDefined();
    expect(response.headers['x-haigo-trace-id']).toBeDefined();

    expect(recordUploadMock).toHaveBeenCalledWith({
      recordUid: 'HG-2024-0009',
      stage: 'inbound',
      category: 'inbound_photo',
      storagePath: expect.any(String),
      publicPath: expect.any(String),
      hashAlgo: 'BLAKE3',
      hashValue: hashValue,
      mimeType: 'image/jpeg',
      sizeBytes: buffer.length,
      uploadedBy: undefined,
      uploadedAt: expect.any(Date)
    });

    const storedPath = path.join(tempDir, response.body.data.storagePath);
    await expect(fs.stat(storedPath)).resolves.toMatchObject({ size: buffer.length });
  });

  it('supports legacy `media` field uploads for identity registration', async () => {
    const buffer = Buffer.from('identity-controller-file');
    const hashValue = computeHash(buffer);

    const response = await request(app.getHttpServer())
      .post('/api/media/uploads')
      .field('record_uid', '0xabc')
      .field('hash', hashValue)
      .field('hash_algo', 'blake3')
      .field('role', 'warehouse')
      .field('address', '0xabc')
      .attach('media', buffer, { filename: 'doc.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(response.body.data.hashValue).toBe(hashValue);
    expect(response.body.data.mimeType).toBe('application/pdf');
    expect(response.body.data.path).toMatch(/\/media\/0xabc/);

    expect(recordUploadMock).toHaveBeenCalledWith({
      recordUid: '0xabc',
      stage: 'inbound',
      category: 'inbound_document',
      storagePath: expect.any(String),
      publicPath: expect.any(String),
      hashAlgo: 'BLAKE3',
      hashValue: hashValue,
      mimeType: 'application/pdf',
      sizeBytes: buffer.length,
      uploadedBy: '0xabc',
      uploadedAt: expect.any(Date)
    });
  });
});
