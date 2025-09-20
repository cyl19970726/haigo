import { expect, test } from '@playwright/test';
import { ensureSession } from '../../apps/web/lib/session/ensureSession';

const toHex = (bytes: Uint8Array) =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

const extractBody = (body: RequestInit['body']): string | undefined => {
  if (!body) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString('utf-8');
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf-8');
  }
  if (Buffer.isBuffer(body)) {
    return body.toString('utf-8');
  }
  return undefined;
};

test.describe('fix-login-1 ensureSession normalization', () => {
  test('sends lower-case 0x hex strings for Uint8Array wallet payloads', async () => {
    process.env.NEXT_PUBLIC_BFF_URL = 'http://localhost:3001';

    const publicKeyBytes = Uint8Array.from([
      0x12, 0x34, 0xab, 0xcd, 0xef, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
      0xff, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0
    ]);

    const signatureBytes = Uint8Array.from([
      0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe, 0x10, 0x20, 0x30, 0x40, 0x55, 0x66, 0x77, 0x88,
      0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33, 0x44, 0x88, 0x99, 0xaa, 0xee, 0xff,
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
      0xf1, 0xe2, 0xd3, 0xc4, 0xb5, 0xa6, 0x97, 0x88, 0x79, 0x6a, 0x5b, 0x4c, 0x3d, 0x2e, 0x1f, 0x00
    ]);

    const rawProfileResponse = {
      address: '0xABCD1234',
      role: 'seller' as const,
      profileHash: {
        algorithm: 'blake3' as const,
        value: 'F'.repeat(64)
      },
      registeredAt: '2025-09-19T00:00:00Z',
      orderCount: 2,
      isVerified: true
    };

    const fetchCalls: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = global.fetch;
    let profileRequestCount = 0;
    let capturedVerifyPayload: Record<string, unknown> | null = null;

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      const bodyString = extractBody(init?.body);

      fetchCalls.push({ url, method, body: bodyString });

      if (url.endsWith('/api/session/profile')) {
        profileRequestCount += 1;
        if (profileRequestCount === 1) {
          return new Response('', { status: 401 });
        }
        return new Response(JSON.stringify({ data: rawProfileResponse }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (url.endsWith('/api/session/challenge')) {
        return new Response(
          JSON.stringify({
            data: {
              address: '0xabcd1234',
              nonce: 'nonce-123',
              message: 'APTOS\n{"nonce":"nonce-123"}'
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }

      if (url.endsWith('/api/session/verify')) {
        if (!bodyString) {
          throw new Error('Missing verify payload');
        }
        capturedVerifyPayload = JSON.parse(bodyString) as Record<string, unknown>;
        return new Response(JSON.stringify({ data: rawProfileResponse, sessionId: 'session-abc' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      throw new Error(`Unexpected fetch invocation to ${url}`);
    }) as typeof fetch;

    try {
      const profile = await ensureSession(
        '0xAbCd1234',
        async () => ({
          signature: { signature: signatureBytes },
          publicKey: publicKeyBytes,
          fullMessage: 'APTOS\n{"nonce":"nonce-123"}'
        }),
        undefined
      );

      expect(profile.address).toBe('0xabcd1234');
      expect(profile.role).toBe('seller');
      expect(profile.profileHash.value).toBe('f'.repeat(64));

      expect(capturedVerifyPayload).not.toBeNull();
      expect(capturedVerifyPayload?.address).toBe('0xabcd1234');
      expect(capturedVerifyPayload?.publicKey).toBe(toHex(publicKeyBytes));
      expect(capturedVerifyPayload?.signature).toBe(toHex(signatureBytes));

      console.log('Captured verify payload:', capturedVerifyPayload);
    } finally {
      global.fetch = originalFetch;
    }

    const verifyCall = fetchCalls.find((call) => call.url.endsWith('/api/session/verify'));
    expect(verifyCall).toBeTruthy();
    expect(verifyCall?.method).toBe('POST');
  });

  test('falls back to provided accountPublicKey string when wallet omits publicKey', async () => {
    process.env.NEXT_PUBLIC_BFF_URL = 'http://localhost:3001';

    const fallbackPublicKey = 'ABCDEF00112233445566778899AABBCCDDEEFF00112233445566778899AABBCC';
    const signatureUppercase = 'DEADBEEFCAFEBABE102030405566778899AABBCCDDEEFF112233448899AAEEFF0123456789ABCDEFFEDCBA9876543210F1E2D3C4B5A69788796A5B4C3D2E1F00';

    const rawProfileResponse = {
      address: '0xDEADBEEF',
      role: 'warehouse' as const,
      profileHash: {
        algorithm: 'blake3' as const,
        value: 'A'.repeat(64)
      },
      registeredAt: '2025-09-20T00:00:00Z'
    };

    let capturedVerifyPayload: Record<string, unknown> | null = null;
    const originalFetch = global.fetch;
    let profileRequestCount = 0;

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      const bodyString = extractBody(init?.body);

      if (url.endsWith('/api/session/profile')) {
        profileRequestCount += 1;
        if (profileRequestCount === 1) {
          return new Response('', { status: 401 });
        }
        return new Response(JSON.stringify({ data: rawProfileResponse }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (url.endsWith('/api/session/challenge')) {
        return new Response(
          JSON.stringify({
            data: {
              address: '0xdeadbeef',
              nonce: 'nonce-987',
              message: 'APTOS\n{"nonce":"nonce-987"}'
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }

      if (url.endsWith('/api/session/verify')) {
        if (!bodyString) {
          throw new Error('Missing verify payload');
        }
        capturedVerifyPayload = JSON.parse(bodyString) as Record<string, unknown>;
        return new Response(JSON.stringify({ data: rawProfileResponse, sessionId: 'session-fallback' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      throw new Error(`Unexpected fetch invocation to ${url}`);
    }) as typeof fetch;

    try {
      const profile = await ensureSession(
        '0xDeadBeef',
        async () => ({
          signature: signatureUppercase
        }),
        fallbackPublicKey
      );

      expect(profile.address).toBe('0xdeadbeef');
      expect(profile.role).toBe('warehouse');
      expect(profile.profileHash.value).toBe('a'.repeat(64));

      expect(capturedVerifyPayload).not.toBeNull();
      expect(capturedVerifyPayload?.publicKey).toBe(
        '0xabcdef00112233445566778899aabbccddeeff00112233445566778899aabbcc'
      );
      expect(capturedVerifyPayload?.signature).toBe(
        '0xdeadbeefcafebabe102030405566778899aabbccddeeff112233448899aaeeff0123456789abcdeffedcba9876543210f1e2d3c4b5a69788796a5b4c3d2e1f00'
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('throws when wallet provides no usable public key or signature', async () => {
    process.env.NEXT_PUBLIC_BFF_URL = 'http://localhost:3001';

    const originalFetch = global.fetch;

    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/api/session/profile')) {
        return new Response('', { status: 401 });
      }

      if (url.endsWith('/api/session/challenge')) {
        return new Response(
          JSON.stringify({
            data: {
              address: '0x1111',
              nonce: 'nonce-000',
              message: 'APTOS\n{"nonce":"nonce-000"}'
            }
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }

      throw new Error(`Unexpected fetch invocation to ${url}`);
    }) as typeof fetch;

    await expect(
      ensureSession(
        '0x1111',
        async () => ({
          signature: 'not-a-hex-value'
        }),
        undefined
      )
    ).rejects.toThrow('Wallet did not return a login signature.');

    global.fetch = originalFetch;
  });
});
