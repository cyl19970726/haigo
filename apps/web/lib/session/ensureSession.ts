'use client';

import type { SignMessagePayload, SignMessageResponse } from '@aptos-labs/wallet-adapter-core';
import type { AccountProfile } from '@shared/dto/registry';
import { fetchSessionProfile, requestSessionChallenge, verifySession } from '../api/session';

export type SignMessageFn = (payload: SignMessagePayload) => Promise<SignMessageResponse | null>;

export async function ensureSession(
  address: string,
  signMessage?: SignMessageFn,
  fallbackPublicKey?: string
): Promise<AccountProfile> {
  const normalizedAddress = address.toLowerCase();

  const existing = await safeFetchProfile();
  if (existing?.address.toLowerCase() === normalizedAddress) {
    return existing;
  }

  if (typeof signMessage !== 'function') {
    throw new Error('Wallet does not support message signing.');
  }

  const challenge = await requestSessionChallenge(normalizedAddress);

  const signature = await signMessage({
    message: challenge.message,
    nonce: challenge.nonce,
    address: false,
    application: false,
    chainId: false
  });

  // 兼容部分钱包不返回 publicKey 的情况，回退使用上下文提供的 accountPublicKey
  const publicKey = signature?.publicKey || fallbackPublicKey;
  if (!signature?.signature || !publicKey) {
    throw new Error('Wallet did not return a login signature.');
  }

  const verified = await verifySession({
    address: normalizedAddress,
    publicKey,
    signature: signature.signature,
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
