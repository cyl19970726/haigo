import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { AccountsRepository } from '../src/modules/accounts/accounts.repository.js';
import { AccountsController } from '../src/modules/accounts/accounts.controller.js';
import { AccountsEventListener } from '../src/modules/accounts/event-listener.service.js';
import { AccountsService } from '../src/modules/accounts/accounts.service.js';
import { MockPrismaService } from './utils/mock-prisma.service';

describe('AccountsModule integration', () => {
  let app: INestApplication;
  let repository: AccountsRepository;
  let listener: AccountsEventListener;
  let fetchMock: jest.SpyInstance;

  beforeAll(async () => {
    const prisma = new MockPrismaService();
    const configStub = {
      get: jest.fn((key: string, defaultValue?: any) => {
        switch (key) {
          case 'hasuraUrl':
            return 'http://localhost:8080';
          case 'indexerUrl':
            return 'https://api.testnet.aptoslabs.com/v1/graphql';
          case 'ingestion.pollingIntervalMs':
            return 10_000;
          case 'ingestion.pageSize':
            return 25;
          default:
            return defaultValue;
        }
      })
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [
        AccountsService,
        AccountsRepository,
        { provide: ConfigService, useValue: configStub },
        { provide: PrismaService, useValue: prisma }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    repository = moduleRef.get(AccountsRepository);
    listener = new AccountsEventListener(configStub, repository);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('processes registration event and serves API responses end-to-end', async () => {
    const fileContent = Buffer.from('integration-test');
    const fileHash = bytesToHex(blake3(fileContent));

    const event = {
      transaction_version: '200',
      event_index: 0,
      type: '0xHAIGO::registry::WarehouseRegistered',
      data: {
        account: '0xdef',
        profile_hash: { value: fileHash },
        profile_uri: 'ipfs://warehouse'
      },
      transaction_hash: '0xintegration',
      account_address: '0xdef',
      transaction_timestamp: new Date('2024-06-12T10:00:00Z').toISOString()
    };

    await (listener as any).processEvent(event);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          seller: { aggregate: { count: 0 } },
          warehouse: { aggregate: { count: 5 } }
        }
      })
    } as any);

    const profileResponse = await request(app.getHttpServer())
      .get('/api/accounts/0xdef')
      .expect(200);

    expect(profileResponse.body.data.address).toBe('0xdef');
    expect(profileResponse.body.data.profileHash.value).toBe(fileHash);
    expect(profileResponse.body.data.orderCount).toBe(5);
    expect(profileResponse.body.meta.requestId).toBeDefined();
    expect(profileResponse.headers['x-haigo-trace-id']).toBeDefined();

    const verifyResponse = await request(app.getHttpServer())
      .post('/api/accounts/0xdef/verify-hash')
      .attach('file', fileContent, 'profile.txt')
      .expect(201);

    expect(verifyResponse.body.data.verified).toBe(true);
    expect(verifyResponse.body.data.computedHash).toBe(fileHash);
  });
});
