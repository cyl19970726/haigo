import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccountsController } from '../src/modules/accounts/accounts.controller.js';
import { AccountsService } from '../src/modules/accounts/accounts.service.js';

describe('AccountsController', () => {
  let app: INestApplication;
  const service = {
    getAccountProfile: jest.fn().mockResolvedValue({
      address: '0xabc',
      role: 'seller',
      profileHash: { algorithm: 'blake3', value: 'a'.repeat(64) },
      registeredAt: new Date('2024-06-10T00:00:00Z').toISOString()
    }),
    verifyProfileHash: jest.fn().mockResolvedValue({
      verified: true,
      computedHash: 'a'.repeat(64),
      storedHash: 'a'.repeat(64)
    })
  } as unknown as jest.Mocked<AccountsService>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [{ provide: AccountsService, useValue: service }]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns account profile with metadata and trace header', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/accounts/0xabc')
      .set('x-haigo-trace-id', 'trace-123')
      .expect(200);

    expect(response.body.data.address).toBe('0xabc');
    expect(response.body.meta.requestId).toBeDefined();
    expect(response.body.meta.timestamp).toBeDefined();
    expect(response.headers['x-haigo-trace-id']).toBe('trace-123');
    expect(service.getAccountProfile).toHaveBeenCalledWith('0xabc');
  });

  it('verifies uploaded hash and returns result payload', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/accounts/0xabc/verify-hash')
      .attach('file', Buffer.from('payload'), 'profile.txt')
      .expect(201);

    expect(response.body.data.verified).toBe(true);
    expect(response.body.meta.requestId).toBeDefined();
    expect(service.verifyProfileHash).toHaveBeenCalled();
  });
});
