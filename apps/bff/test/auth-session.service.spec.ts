import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Ed25519PrivateKey } from '@aptos-labs/ts-sdk';
import type { AccountProfile } from '@haigo/shared/dto/registry';
import { AuthSessionService } from '../src/modules/auth-session/auth-session.service.js';

const mockProfile: AccountProfile = {
  address: '0x1',
  role: 'seller',
  profileHash: { algorithm: 'blake3', value: 'a'.repeat(64) },
  registeredAt: new Date('2024-01-01T00:00:00Z').toISOString()
};

describe('AuthSessionService', () => {
  const accountsService = {
    getAccountProfile: jest.fn()
  } as unknown as { getAccountProfile: jest.Mock };

  let service: AuthSessionService;

  beforeEach(() => {
    accountsService.getAccountProfile = jest.fn().mockResolvedValue(mockProfile);
    service = new AuthSessionService(accountsService as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates challenge and verifies session with a valid signature', async () => {
    const privateKey = Ed25519PrivateKey.generate();
    const publicKey = privateKey.publicKey();
    const address = publicKey.authKey().derivedAddress().toString();

    const challenge = service.createChallenge(address);
    expect(challenge.address).toBe(address);
    expect(challenge.nonce).toBeDefined();
    expect(challenge.message).toContain(challenge.nonce);

    const signature = privateKey.sign(challenge.message);
    const result = await service.verifyChallenge({
      address,
      publicKey: publicKey.toString(),
      signature: signature.toString()
    });

    expect(result.profile).toEqual(mockProfile);
    expect(result.sessionId).toBeDefined();

    const sessionProfile = await service.getProfileForSession(result.sessionId);
    expect(sessionProfile).toEqual(mockProfile);
  });

  it('throws when verifying with an invalid signature', async () => {
    const privateKey = Ed25519PrivateKey.generate();
    const publicKey = privateKey.publicKey();
    const address = publicKey.authKey().derivedAddress().toString();

    const challenge = service.createChallenge(address);

    await expect(
      service.verifyChallenge({
        address,
        publicKey: publicKey.toString(),
        signature: `0x${'00'.repeat(64)}`
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws for invalid address input', () => {
    expect(() => service.createChallenge('not-an-address')).toThrow(BadRequestException);
  });
});
