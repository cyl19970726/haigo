import { cookies } from 'next/headers';
import type { AccountProfile } from '@shared/dto/registry';
import { normalizeAccountResponse } from '@shared/dto/registry';

const SESSION_COOKIE_NAME = 'haigo_session';

const resolveBffBase = (): string => {
  const base = process.env.NEXT_PUBLIC_BFF_URL || process.env.BFF_URL || '';
  return base.replace(/\/$/, '');
};

export async function loadSessionProfileFromServer(): Promise<AccountProfile | null> {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie?.value) {
    return null;
  }

  const baseUrl = resolveBffBase();
  if (!baseUrl) {
    throw new Error('BFF base URL is not configured. Set NEXT_PUBLIC_BFF_URL or BFF_URL.');
  }

  const response = await fetch(`${baseUrl}/api/session/profile`, {
    method: 'GET',
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${sessionCookie.value}`,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Session profile request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { data: any };
  return normalizeAccountResponse(payload.data ?? null);
}
