'use client';

import type { AccountResponse, AccountProfile } from '@shared/dto/registry';

interface ApiMeta {
  requestId?: string;
  timestamp?: string;
}

interface ApiEnvelope<T> {
  data: T;
  meta?: ApiMeta;
}

interface UploadResponseBody {
  recordUid: string;
  path: string;
  hash: {
    algo: string;
    value: string;
  };
}

const BFF_BASE = (process.env.NEXT_PUBLIC_BFF_URL || '').replace(/\/$/, '');

const buildUrl = (path: string) => {
  if (!BFF_BASE) return path;
  return `${BFF_BASE}${path}`;
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
};

const extractData = <T>(payload: ApiEnvelope<T> | T): T => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const mapAccountResponse = (payload: AccountResponse): AccountProfile => ({
  address: payload.address,
  role: payload.role,
  profileHash: {
    algo: payload.profileHash.algorithm,
    value: payload.profileHash.value
  },
  profileUri: payload.profileUri,
  registeredAt: payload.registeredAt,
  orderCount: payload.orderCount
});

export async function fetchAccountProfile(address: string): Promise<AccountProfile | null> {
  const response = await fetch(buildUrl(`/api/accounts/${address}`), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to load account profile');
  }

  const body = await parseJson<ApiEnvelope<AccountResponse> | AccountResponse>(response);
  const data = extractData(body);
  if (!data) {
    return null;
  }
  return mapAccountResponse(data);
}

export interface UploadIdentityParams {
  file: File;
  address: string;
  role: 'seller' | 'warehouse';
  hash: string;
}

export async function uploadIdentityDocument({ file, address, role, hash }: UploadIdentityParams): Promise<UploadResponseBody> {
  const formData = new FormData();
  formData.append('record_uid', address);
  formData.append('address', address);
  formData.append('role', role);
  formData.append('hash', hash);
  formData.append('hash_algo', 'blake3');
  formData.append('media', file);

  const response = await fetch(buildUrl('/api/media/uploads'), {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const body = await parseJson<{ message?: string }>(response);
    throw new Error(body?.message || 'Failed to upload documentation');
  }

  const body = await parseJson<ApiEnvelope<UploadResponseBody> | UploadResponseBody>(response);
  return extractData(body);
}
