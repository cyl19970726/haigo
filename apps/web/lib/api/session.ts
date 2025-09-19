'use client';

import type { AccountProfile } from '@shared/dto/registry';
import { normalizeAccountResponse } from '@shared/dto/registry';

const BFF_BASE = (process.env.NEXT_PUBLIC_BFF_URL || '').replace(/\/$/, '');

const buildUrl = (path: string) => (BFF_BASE ? `${BFF_BASE}${path}` : path);

const parseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
};

export interface SessionChallengeResponse {
  address: string;
  nonce: string;
  message: string;
}

export interface SessionProfileResponse {
  data: AccountProfile | null;
}

export async function requestSessionChallenge(address: string): Promise<SessionChallengeResponse> {
  const response = await fetch(buildUrl('/api/session/challenge'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ address })
  });

  if (!response.ok) {
    const payload = await parseJson<{ message?: string }>(response);
    throw new Error(payload?.message || 'Failed to request login challenge');
  }

  const payload = await parseJson<{ data: SessionChallengeResponse }>(response);
  return payload.data;
}

export async function verifySession(payload: { address: string; publicKey: string; signature: string }) {
  const response = await fetch(buildUrl('/api/session/verify'), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to verify session');
  }

  const body = await parseJson<{ data: AccountProfile }>(response);
  return body.data;
}

export async function fetchSessionProfile(): Promise<AccountProfile | null> {
  const response = await fetch(buildUrl('/api/session/profile'), {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to load session profile');
  }

  const payload = await parseJson<{ data: AccountProfile | null }>(response);
  return normalizeAccountResponse(payload.data ?? undefined);
}

export async function logoutSession() {
  await fetch(buildUrl('/api/session/logout'), {
    method: 'POST',
    credentials: 'include'
  });
}
