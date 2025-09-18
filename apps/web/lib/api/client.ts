'use client';

export interface ApiMeta {
  requestId?: string;
  timestamp?: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: ApiMeta;
}

const BFF_BASE = (process.env.NEXT_PUBLIC_BFF_URL || '').replace(/\/$/, '');

export const buildUrl = (path: string) => {
  if (!BFF_BASE) return path;
  return `${BFF_BASE}${path}`;
};

export const parseJson = async <T>(response: Response): Promise<T> => {
  const bodyText = await response.text();
  if (!bodyText) {
    return {} as T;
  }
  return JSON.parse(bodyText) as T;
};

export const extractData = <T>(payload: ApiEnvelope<T> | T): T => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};
