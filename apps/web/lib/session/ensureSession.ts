'use client';

import type { AptosSignMessageInput, AptosSignMessageOutput } from '@aptos-labs/wallet-adapter-core';
import type { AccountProfile } from '@shared/dto/registry';
import { fetchSessionProfile, requestSessionChallenge, verifySession } from '../api/session';

type WalletSignMessageResult = AptosSignMessageOutput & { publicKey?: string; fullMessage?: string };

export type SignMessageFn = (payload: AptosSignMessageInput) => Promise<WalletSignMessageResult | null>;

export interface EnsureSessionCallbacks {
  onChallenge?: () => void;
  onSigning?: () => void;
  onVerifying?: () => void;
}

const HEX_PREFIX = '0x';

const isHexString = (value: string) => /^[0-9a-f]+$/i.test(value);

const toHexString = (input: unknown): string | null => {
  if (input == null) return null;

  if (input instanceof Uint8Array) {
    if (!input.length) return null;
    const hex = Array.from(input, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${HEX_PREFIX}${hex}`;
  }

  if (typeof input === 'string') {
    const trimmed = input.startsWith(HEX_PREFIX) ? input.slice(2) : input;
    if (!trimmed.length || trimmed.length % 2 !== 0 || !isHexString(trimmed)) {
      return null;
    }
    return `${HEX_PREFIX}${trimmed.toLowerCase()}`;
  }

  if (typeof input === 'object' && typeof (input as { toString?: () => string }).toString === 'function') {
    const text = (input as { toString: () => string }).toString();
    return toHexString(text);
  }

  return null;
};

export async function ensureSession(
  address: string,
  signMessage?: SignMessageFn,
  fallbackPublicKey?: string,
  callbacks?: EnsureSessionCallbacks
): Promise<AccountProfile> {
  const normalizedAddress = address.toLowerCase();

  const existing = await safeFetchProfile();
  if (existing?.address.toLowerCase() === normalizedAddress) {
    return existing;
  }

  if (typeof signMessage !== 'function') {
    throw new Error('Wallet does not support message signing.');
  }

  callbacks?.onChallenge?.();
  const challenge = await requestSessionChallenge(normalizedAddress);

  callbacks?.onSigning?.();
  const signature = await signMessage({
    message: challenge.message,
    nonce: challenge.nonce,
    address: false,
    application: false,
    chainId: false
  });

  // 兼容部分钱包不返回 publicKey 的情况，回退使用上下文提供的 accountPublicKey
  const publicKeyHex = toHexString(signature?.publicKey) ?? toHexString(fallbackPublicKey);
  const rawSignatureValue =
    (signature as any)?.signature?.signature ??
    (signature as any)?.signature ??
    (typeof signature?.signature === 'string' ? signature.signature : null);
  const signatureHex = toHexString(rawSignatureValue ?? signature?.signature);

  if (!signatureHex || !publicKeyHex) {
    throw new Error('Wallet did not return a login signature.');
  }

  callbacks?.onVerifying?.();
  const verified = await verifySession({
    address: normalizedAddress,
    publicKey: publicKeyHex,
    signature: signatureHex,
    fullMessage: (signature as any)?.fullMessage
  });

  // 将 BFF 返回的 sessionId 通过本地 dev API 写入同域 HttpOnly Cookie，供 SSR 读取（开发用途）
  try {
    if (typeof window !== 'undefined' && verified.sessionId) {
      await fetch('/api/dev/session/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionId: verified.sessionId, maxAgeSeconds: 3600 })
      });
    }
  } catch {
    // 回退到非 HttpOnly Cookie（仅用于开发降级）
    try {
      if (typeof window !== 'undefined' && verified.sessionId) {
        document.cookie = `haigo_session=${encodeURIComponent(verified.sessionId)}; Path=/; Max-Age=3600; SameSite=Lax`;
      }
    } catch {}
  }

  const profile = await fetchSessionProfile();
  if (!profile || profile.address.toLowerCase() !== normalizedAddress) {
    throw new Error('Session verification failed.');
  }
  return profile;
}

async function safeFetchProfile(): Promise<AccountProfile | null> {
  try {
    return await fetchSessionProfile();
  } catch (error) {
    console.warn('[HaiGo] fetchSessionProfile failed', error);
    return null;
  }
}
