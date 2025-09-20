import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAccountProfile, uploadIdentityDocument } from './registration';

declare const global: typeof globalThis & { fetch: ReturnType<typeof vi.fn> };

const mockAddress = '0x1';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_BFF_URL', '');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAccountProfile', () => {
  it('maps API response to AccountProfile structure', async () => {
    const payload = {
      data: {
        address: mockAddress,
        role: 'seller' as const,
        profileHash: { algorithm: 'blake3' as const, value: 'a'.repeat(64) },
        registeredAt: '2025-01-01T00:00:00Z',
        isVerified: true,
        profileUri: 'https://example.com/profile',
        orderCount: 3
      }
    };

    global.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));

    const result = await fetchAccountProfile(mockAddress);
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/accounts/${mockAddress}`,
      expect.objectContaining({ credentials: 'include' })
    );
    expect(result).toEqual({
      address: mockAddress,
      role: 'seller',
      profileHash: { algorithm: 'blake3', value: 'a'.repeat(64) },
      registeredAt: '2025-01-01T00:00:00Z',
      profileUri: 'https://example.com/profile',
      orderCount: 3,
      isVerified: true
    });
  });

  it('returns null for 404 responses', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 404 }));

    const result = await fetchAccountProfile(mockAddress);
    expect(result).toBeNull();
  });
});

describe('uploadIdentityDocument', () => {
  it('sends multipart form data with expected fields', async () => {
    const mockResponse = {
      data: {
        recordUid: mockAddress,
        path: '/uploads/mock.pdf',
        hash: { algo: 'blake3', value: 'b'.repeat(64) }
      }
    };

    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.get('record_uid')).toBe(mockAddress);
      expect(body.get('address')).toBe(mockAddress);
      expect(body.get('role')).toBe('seller');
      expect(body.get('hash')).toBe('b'.repeat(64));
      expect(body.get('hash_algo')).toBe('blake3');
      expect(body.get('media')).toBeInstanceOf(File);
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    global.fetch = fetchSpy as unknown as typeof global.fetch;

    const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
    const result = await uploadIdentityDocument({ file, address: mockAddress, role: 'seller', hash: 'b'.repeat(64) });

    expect(fetchSpy).toHaveBeenCalledWith('/api/media/uploads', expect.objectContaining({ credentials: 'include' }));
    expect(result).toEqual(mockResponse.data);
  });
});
