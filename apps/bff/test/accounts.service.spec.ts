import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import type { Express } from 'express';
import { AccountsRepository } from '../src/modules/accounts/accounts.repository.js';
import { AccountsService } from '../src/modules/accounts/accounts.service.js';
import { MockPrismaService } from './utils/mock-prisma.service';

const defaultConfig = {
  get: jest.fn((key: string, defaultValue?: any) => {
    switch (key) {
      case 'hasuraUrl':
        return 'http://localhost:8080';
      default:
        return defaultValue;
    }
  })
} as unknown as ConfigService;

describe('AccountsService', () => {
  let repository: AccountsRepository;
  let service: AccountsService;

  beforeEach(async () => {
    const prisma = new MockPrismaService();
    repository = new AccountsRepository(prisma as any);
    service = new AccountsService(repository, defaultConfig);

    await repository.upsertFromEvent({
      accountAddress: '0xabc',
      role: 'seller',
      profileHashValue: 'a'.repeat(64),
      profileUri: 'ipfs://profile',
      registeredBy: '0xabc',
      txnVersion: BigInt(1),
      eventIndex: BigInt(0),
      txnHash: '0xhash',
      chainTimestamp: new Date('2024-06-10T00:00:00Z')
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns account profile with order counts', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          seller: { aggregate: { count: 3 } },
          warehouse: { aggregate: { count: 0 } }
        }
      })
    } as any);

    const profile = await service.getAccountProfile('0xAbC');

    expect(profile.address).toBe('0xabc');
    expect(profile.profileHash.value).toBe('a'.repeat(64));
    expect(profile.orderCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws for invalid address format', async () => {
    await expect(service.getAccountProfile('not-an-address')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws not found when repository has no record', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ data: {} }) } as any);
    await expect(service.getAccountProfile('0xdef')).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies profile hash from uploaded file', async () => {
    const content = Buffer.from('hello world');
    const expectedHash = bytesToHex(blake3(content));

    await repository.upsertFromEvent({
      accountAddress: '0x123',
      role: 'warehouse',
      profileHashValue: expectedHash,
      profileUri: null,
      registeredBy: '0x123',
      txnVersion: BigInt(2),
      eventIndex: BigInt(1),
      txnHash: '0xhash2',
      chainTimestamp: new Date('2024-06-11T00:00:00Z')
    });

    const result = await service.verifyProfileHash('0x123', {
      buffer: content
    } as Express.Multer.File);

    expect(result.verified).toBe(true);
    expect(result.computedHash).toBe(expectedHash);
  });

  it('returns mismatch result when hash differs', async () => {
    const content = Buffer.from('different');

    const result = await service.verifyProfileHash('0xabc', {
      buffer: content
    } as Express.Multer.File);

    expect(result.verified).toBe(false);
  });
});
