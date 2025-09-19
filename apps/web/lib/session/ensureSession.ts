'use client';

import type { SignMessagePayload, SignMessageResponse } from '@aptos-labs/wallet-adapter-core';
import type { AccountProfile } from '@shared/dto/registry';
import { fetchSessionProfile, requestSessionChallenge, verifySession } from '../api/session';

export type SignMessageFn = (payload: SignMessagePayload) => Promise<SignMessageResponse | null>;

export async function ensureSession(address: string, signMessage?: SignMessageFn): Promise<AccountProfile> {
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

  if (!signature?.signature || !signature.publicKey) {
    throw new Error('Wallet did not return a login signature.');
  }

  await verifySession({
    address: normalizedAddress,
    publicKey: signature.publicKey,
    signature: signature.signature
  });

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
