'use client';

import type {
  OrderMediaAsset,
  OrderMediaHashAlgorithm,
  OrderMediaStage,
  OrderMediaVerificationStatus
} from '@shared/dto/orders';
import { ORDER_MEDIA_ERROR_CODES } from '@shared/config';
import { extractData, parseJson, buildUrl, type ApiEnvelope } from './client';

export interface UploadMediaRequest {
  recordUid: string;
  file: File;
  stage: OrderMediaStage;
  category: string;
  hashAlgorithm: OrderMediaHashAlgorithm;
  hashValue: string;
  crossCheckHashAlgorithm?: OrderMediaHashAlgorithm;
  crossCheckHashValue?: string;
  onProgress?: (progress: number) => void;
}

export interface UploadMediaError extends Error {
  code?: string;
  status?: number;
}

const normalizeHash = (value: string) => value.replace(/^0x/, '').toLowerCase();

const buildUploadError = (message: string, status?: number, code?: string): UploadMediaError => {
  const error = new Error(message) as UploadMediaError;
  error.status = status;
  error.code = code;
  return error;
};

export const uploadMediaAsset = ({
  recordUid,
  file,
  stage,
  category,
  hashAlgorithm,
  hashValue,
  crossCheckHashAlgorithm,
  crossCheckHashValue,
  onProgress
}: UploadMediaRequest): Promise<OrderMediaAsset> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl('/api/media/uploads'));
    xhr.responseType = 'text';

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      } else {
        onProgress(0);
      }
    };

    xhr.onerror = () => {
      reject(buildUploadError('Network error while uploading media', xhr.status || 0));
    };

    xhr.onload = () => {
      const { status } = xhr;
      const responseText = xhr.responseText;

      if (status < 200 || status >= 300) {
        let message = `Upload failed with status ${status}`;
        let code: string | undefined;
        try {
          const body = responseText ? JSON.parse(responseText) : undefined;
          message = body?.message || message;
          code = body?.code;
        } catch (error) {
          console.warn('[HaiGo] Failed to parse media upload error response', error);
        }
        reject(buildUploadError(message, status, code));
        return;
      }

      try {
        const parsed = responseText ? JSON.parse(responseText) : {};
        const data = extractData(parsed as ApiEnvelope<OrderMediaAsset> | OrderMediaAsset);
        const normalizedExpected = normalizeHash(hashValue);
        const legacyHash =
          typeof data.hash === 'string'
            ? data.hash
            : data.hash && typeof data.hash === 'object' && 'value' in data.hash
              ? (data.hash.value as string | undefined)
              : undefined;
        const rawData = data as unknown as Record<string, unknown>;
        const serverHash =
          data.hashValue ??
          legacyHash ??
          (rawData['hash_value'] as string | undefined) ??
          (rawData['hashValueHex'] as string | undefined);
        if (serverHash) {
          const normalizedServer = normalizeHash(serverHash);
          if (normalizedServer !== normalizedExpected) {
            reject(buildUploadError('Hash mismatch between client and server', status, ORDER_MEDIA_ERROR_CODES.HASH_MISMATCH));
            return;
          }
        }

        const asset: OrderMediaAsset = {
          ...data,
          hashAlgorithm,
          hashValue,
          crossCheckHashAlgorithm: crossCheckHashAlgorithm ?? data.crossCheckHashAlgorithm,
          crossCheckHashValue: crossCheckHashValue ?? data.crossCheckHashValue,
          sizeBytes: data.sizeBytes ?? file.size,
          mimeType: data.mimeType ?? file.type,
          stage: data.stage ?? stage,
          category: data.category ?? category,
          matchedOffchain: data.matchedOffchain ?? false
        };

        resolve(asset);
      } catch (error) {
        reject(buildUploadError('Failed to parse upload response', status));
      }
    };

    const formData = new FormData();
    formData.append('file', file);
    formData.append('record_uid', recordUid);
    formData.append('stage', stage);
    formData.append('category', category);
    formData.append('hash_algorithm', hashAlgorithm);
    formData.append('hash_value', hashValue);
    if (crossCheckHashAlgorithm && crossCheckHashValue) {
      formData.append('cross_check_hash_algorithm', crossCheckHashAlgorithm);
      formData.append('cross_check_hash_value', crossCheckHashValue);
    }
    formData.append('size_bytes', file.size.toString());
    formData.append('mime_type', file.type);

    xhr.send(formData);
  });
};

export interface MediaReverifyRequest {
  recordUid: string;
  assetId?: string;
  hashValue: string;
  stage: OrderMediaStage;
  category?: string;
}

export interface MediaReverifyResponse {
  asset?: OrderMediaAsset;
  status: OrderMediaVerificationStatus;
  message?: string;
}

export const requestMediaReverification = async ({
  recordUid,
  assetId,
  hashValue,
  stage,
  category
}: MediaReverifyRequest): Promise<MediaReverifyResponse> => {
  const response = await fetch(buildUrl(`/api/orders/${encodeURIComponent(recordUid)}/media-verify`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      assetId,
      hashValue,
      stage,
      category
    })
  });

  if (!response.ok) {
    const body = await parseJson<{ message?: string; code?: string }>(response);
    const error: UploadMediaError = new Error(body?.message || 'Failed to trigger media verification');
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }

  const body = await parseJson<ApiEnvelope<MediaReverifyResponse> | MediaReverifyResponse>(response);
  const data = extractData(body);
  return data ?? { status: 'pending' };
};
