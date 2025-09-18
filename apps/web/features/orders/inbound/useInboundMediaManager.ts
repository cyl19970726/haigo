'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ORDER_MEDIA_ACCEPTED_MIME,
  ORDER_MEDIA_CATEGORIES,
  ORDER_MEDIA_ERROR_CODES,
  ORDER_MEDIA_HASH_ALGORITHMS,
  ORDER_MEDIA_MAX_SIZE_BYTES,
  ORDER_MEDIA_STAGES,
  ORDER_MEDIA_VERIFICATION_STATUSES
} from '@shared/config';
import type {
  OrderMediaAsset,
  OrderMediaHashAlgorithm,
  OrderMediaVerificationStatus
} from '@shared/dto/orders';
import { hashFileBlake3 } from '../../../lib/crypto/blake3';
import { hashFileKeccak256 } from '../../../lib/crypto/keccak';
import { uploadMediaAsset } from '../../../lib/api/media';
import type { CachedMediaItem } from '../../../lib/storage/inbound-media-cache';

const FALLBACK_THROTTLE_MS = 5000;

const buildPreview = (file: File) => {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return undefined;
  }
  return URL.createObjectURL(file);
};

const destroyPreview = (url?: string) => {
  if (!url) return;
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return;
  }
  URL.revokeObjectURL(url);
};

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
};

const normalizedMime = (value: string) => value?.toLowerCase();

const allowedMimeSet = new Set(
  [...ORDER_MEDIA_ACCEPTED_MIME.IMAGE, ...ORDER_MEDIA_ACCEPTED_MIME.VIDEO, ...ORDER_MEDIA_ACCEPTED_MIME.DOCUMENT].map(
    normalizedMime
  )
);

const resolveCategory = (mime: string) => {
  const value = normalizedMime(mime);
  if (ORDER_MEDIA_ACCEPTED_MIME.IMAGE.map(normalizedMime).includes(value)) {
    return ORDER_MEDIA_CATEGORIES.INBOUND_PHOTO;
  }
  if (ORDER_MEDIA_ACCEPTED_MIME.VIDEO.map(normalizedMime).includes(value)) {
    return ORDER_MEDIA_CATEGORIES.INBOUND_VIDEO;
  }
  return ORDER_MEDIA_CATEGORIES.INBOUND_DOCUMENT;
};

const resolveMaxSize = (mime: string) => {
  const value = normalizedMime(mime);
  if (ORDER_MEDIA_ACCEPTED_MIME.IMAGE.map(normalizedMime).includes(value)) {
    return ORDER_MEDIA_MAX_SIZE_BYTES.IMAGE;
  }
  if (ORDER_MEDIA_ACCEPTED_MIME.VIDEO.map(normalizedMime).includes(value)) {
    return ORDER_MEDIA_MAX_SIZE_BYTES.VIDEO;
  }
  return ORDER_MEDIA_MAX_SIZE_BYTES.DOCUMENT;
};

export interface MediaManagerMessage {
  id: string;
  type: 'info' | 'error';
  message: string;
}

export interface InboundMediaItem {
  id: string;
  file: File;
  fileName: string;
  fileType: string;
  fileSize: number;
  stage: string;
  category: string;
  blake3?: string;
  keccak256?: string;
  hashStatus: 'pending' | 'processing' | 'ready' | 'error';
  hashError?: string;
  uploadStatus: 'idle' | 'uploading' | 'uploaded' | 'error';
  uploadError?: string;
  uploadProgress: number;
  verificationStatus: OrderMediaVerificationStatus;
  verificationAttempts: number;
  matchedOffchain: boolean;
  lastVerificationAt?: string;
  lastErrorAt?: number;
  retries: number;
  response?: OrderMediaAsset;
  previewUrl?: string;
}

export interface UseInboundMediaManagerOptions {
  recordUid: string;
  cachedItems?: CachedMediaItem[];
}

export interface InboundMediaManager {
  items: InboundMediaItem[];
  addFiles: (files: FileList | File[]) => void;
  removeItem: (id: string) => void;
  reset: () => void;
  uploadItem: (id: string) => Promise<OrderMediaAsset | null>;
  uploadAll: () => Promise<OrderMediaAsset[]>;
  markAsset: (asset: OrderMediaAsset) => void;
  updateVerificationStatus: (
    hashValue: string,
    status: OrderMediaVerificationStatus,
    options?: { increment?: boolean }
  ) => void;
  markMatched: (hashValue: string, matched?: boolean) => void;
  messages: MediaManagerMessage[];
  dismissMessage: (id: string) => void;
  primaryHashAlgorithm: OrderMediaHashAlgorithm;
  secondaryHashAlgorithm: OrderMediaHashAlgorithm;
  hasPendingUploads: boolean;
  isProcessing: boolean;
  toCachePayload: () => CachedMediaItem[];
}

const buildCachedItem = (item: InboundMediaItem): CachedMediaItem => {
  return {
    id: item.id,
    fileName: item.fileName,
    fileType: item.fileType,
    fileSize: item.fileSize,
    stage: item.stage,
    category: item.category,
    hashValue: item.blake3,
    crossCheckHashValue: item.keccak256,
    matchedOffchain: item.matchedOffchain,
    verificationStatus: item.verificationStatus,
    verificationAttempts: item.verificationAttempts,
    updatedAt: Date.now(),
    blob: item.file
  };
};

const rebuildFromCache = (cached: CachedMediaItem): InboundMediaItem | null => {
  try {
    const file = cached.blob
      ? new File([cached.blob], cached.fileName, { type: cached.fileType, lastModified: Date.now() })
      : new File([], cached.fileName, { type: cached.fileType });

    const previewUrl = buildPreview(file);

    return {
      id: cached.id,
      file,
      fileName: cached.fileName,
      fileType: cached.fileType,
      fileSize: cached.fileSize,
      stage: cached.stage,
      category: cached.category,
      blake3: cached.hashValue,
      keccak256: cached.crossCheckHashValue,
      hashStatus: cached.hashValue ? 'ready' : 'pending',
      hashError: undefined,
      uploadStatus: 'idle',
      uploadError: undefined,
      uploadProgress: 0,
      verificationStatus: cached.verificationStatus ?? ORDER_MEDIA_VERIFICATION_STATUSES.PENDING,
      verificationAttempts: cached.verificationAttempts ?? 0,
      matchedOffchain: cached.matchedOffchain ?? false,
      lastVerificationAt: undefined,
      lastErrorAt: undefined,
      retries: 0,
      response: undefined,
      previewUrl
    } satisfies InboundMediaItem;
  } catch (error) {
    console.warn('[HaiGo] failed to rebuild cached media item', error);
    return null;
  }
};

export const useInboundMediaManager = ({ recordUid, cachedItems }: UseInboundMediaManagerOptions): InboundMediaManager => {
  const [items, setItems] = useState<InboundMediaItem[]>(() => {
    if (!cachedItems?.length) return [];
    return cachedItems
      .map(rebuildFromCache)
      .filter((item): item is InboundMediaItem => Boolean(item));
  });
  const [messages, setMessages] = useState<MediaManagerMessage[]>([]);

  useEffect(() => () => {
    items.forEach((item) => destroyPreview(item.previewUrl));
  }, []);

  useEffect(() => {
    if (!cachedItems?.length || items.length > 0) return;
    setItems(
      cachedItems
        .map(rebuildFromCache)
        .filter((item): item is InboundMediaItem => Boolean(item))
    );
  }, [cachedItems, items.length]);

  const primaryHashAlgorithm = ORDER_MEDIA_HASH_ALGORITHMS.BLAKE3;
  const secondaryHashAlgorithm = ORDER_MEDIA_HASH_ALGORITHMS.KECCAK256;

  const pushMessage = useCallback((type: 'info' | 'error', message: string) => {
    setMessages((prev) => [...prev, { id: createId(), type, message }]);
  }, []);

  const dismissMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<InboundMediaItem> | ((item: InboundMediaItem) => Partial<InboundMediaItem>)) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          const nextPatch = typeof patch === 'function' ? patch(item) : patch;
          return { ...item, ...nextPatch };
        })
      );
    },
    []
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const collection = Array.from(files);
      if (!collection.length) return;

      setItems((prev) => {
        const next = [...prev];

        collection.forEach((file) => {
          const mime = normalizedMime(file.type);
          if (!allowedMimeSet.has(mime)) {
            pushMessage('error', `文件 ${file.name} 的类型 ${file.type || '未知'} 未被允许上传`);
            return;
          }

          const maxSize = resolveMaxSize(file.type);
          if (file.size > maxSize) {
            const limitMb = (maxSize / (1024 * 1024)).toFixed(0);
            pushMessage('error', `文件 ${file.name} 超出允许大小（最大 ${limitMb} MB）`);
            return;
          }

          const stage = ORDER_MEDIA_STAGES.INBOUND;
          const category = resolveCategory(file.type);
          const id = createId();
          const previewUrl = buildPreview(file);

          const item: InboundMediaItem = {
            id,
            file,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            stage,
            category,
            blake3: undefined,
            keccak256: undefined,
            hashStatus: 'processing',
            hashError: undefined,
            uploadStatus: 'idle',
            uploadError: undefined,
            uploadProgress: 0,
            verificationStatus: ORDER_MEDIA_VERIFICATION_STATUSES.PENDING,
            verificationAttempts: 0,
            matchedOffchain: false,
            retries: 0,
            lastErrorAt: undefined,
            lastVerificationAt: undefined,
            response: undefined,
            previewUrl
          };

          next.push(item);

          void hashFileBlake3(file)
            .then((hash) => {
              updateItem(id, { blake3: hash, hashStatus: 'processing' });
              return hashFileKeccak256(file).catch((error) => {
                console.warn('[HaiGo] failed to compute keccak256 hash', error);
                return undefined;
              });
            })
            .then((keccak) => {
              updateItem(id, {
                keccak256: keccak,
                hashStatus: 'ready',
                hashError: undefined
              });
            })
            .catch((error) => {
              console.error('[HaiGo] failed to compute media hashes', error);
              updateItem(id, {
                hashStatus: 'error',
                hashError: error instanceof Error ? error.message : '无法计算文件哈希'
              });
            });
        });

        return next;
      });
    },
    [pushMessage, updateItem]
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        destroyPreview(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const reset = useCallback(() => {
    setItems((prev) => {
      prev.forEach((item) => destroyPreview(item.previewUrl));
      return [];
    });
    setMessages([]);
  }, []);

  const uploadItem = useCallback(
    async (id: string): Promise<OrderMediaAsset | null> => {
      const target = items.find((item) => item.id === id);
      if (!target) return null;

      if (target.hashStatus !== 'ready' || !target.blake3) {
        pushMessage('error', `文件 ${target.fileName} 尚未完成哈希计算`);
        return null;
      }

      if (target.uploadStatus === 'uploading') {
        return target.response ?? null;
      }

      if (target.lastErrorAt && Date.now() - target.lastErrorAt < FALLBACK_THROTTLE_MS) {
        pushMessage('error', `请稍候再重试上传 ${target.fileName}`);
        return null;
      }

      updateItem(id, {
        uploadStatus: 'uploading',
        uploadProgress: 0,
        uploadError: undefined
      });

      try {
        const response = await uploadMediaAsset({
          recordUid,
          file: target.file,
          stage: target.stage,
          category: target.category,
          hashAlgorithm: primaryHashAlgorithm,
          hashValue: target.blake3,
          crossCheckHashAlgorithm: target.keccak256 ? secondaryHashAlgorithm : undefined,
          crossCheckHashValue: target.keccak256,
          onProgress: (progress) => {
            updateItem(id, { uploadProgress: progress });
          }
        });

        updateItem(id, {
          uploadStatus: 'uploaded',
          uploadProgress: 1,
          response,
          matchedOffchain: Boolean(response.matchedOffchain),
          verificationStatus: response.verificationStatus ?? ORDER_MEDIA_VERIFICATION_STATUSES.PENDING
        });

        return response;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : '上传失败，请稍后重试';

        updateItem(id, (prev) => ({
          uploadStatus: 'error',
          uploadError: message,
          lastErrorAt: Date.now(),
          retries: prev.retries + 1
        }));

        if ((error as { code?: string } | undefined)?.code === ORDER_MEDIA_ERROR_CODES.HASH_MISMATCH) {
          pushMessage('error', `文件 ${target.fileName} 上传后哈希不一致，请重新选择`);
        } else {
          pushMessage('error', `上传 ${target.fileName} 失败：${message}`);
        }

        return null;
      }
    },
    [items, primaryHashAlgorithm, recordUid, secondaryHashAlgorithm, updateItem, pushMessage]
  );

  const uploadAll = useCallback(async (): Promise<OrderMediaAsset[]> => {
    const results: OrderMediaAsset[] = [];
    for (const item of items) {
      if (item.uploadStatus === 'uploaded') {
        if (item.response) {
          results.push(item.response);
        }
        continue;
      }
      const response = await uploadItem(item.id);
      if (response) {
        results.push(response);
      } else {
        // stop on first failure to allow user intervention
        break;
      }
    }
    return results;
  }, [items, uploadItem]);

  const markAsset = useCallback(
    (asset: OrderMediaAsset) => {
      const normalizedHash = asset.hashValue?.replace(/^0x/, '').toLowerCase();
      setItems((prev) =>
        prev.map((item) => {
          const itemHash = item.blake3?.replace(/^0x/, '').toLowerCase();
          if (!itemHash || itemHash !== normalizedHash) return item;
          return {
            ...item,
            response: asset,
            verificationStatus:
              asset.verificationStatus ?? item.verificationStatus,
            matchedOffchain: asset.matchedOffchain ?? item.matchedOffchain,
            uploadStatus: asset.storagePath ? 'uploaded' : item.uploadStatus
          };
        })
      );
    },
    []
  );

  const updateVerificationStatus = useCallback(
    (hashValue: string, status: OrderMediaVerificationStatus, options?: { increment?: boolean }) => {
      const normalizedHash = hashValue.replace(/^0x/, '').toLowerCase();
      const increment = options?.increment ?? true;
      setItems((prev) =>
        prev.map((item) => {
          if (item.blake3?.replace(/^0x/, '').toLowerCase() !== normalizedHash) {
            return item;
          }
          return {
            ...item,
            verificationStatus: status,
            verificationAttempts: increment ? item.verificationAttempts + 1 : item.verificationAttempts,
            lastVerificationAt: new Date().toISOString()
          };
        })
      );
    },
    []
  );

  const markMatched = useCallback((hashValue: string, matched = true) => {
    const normalizedHash = hashValue.replace(/^0x/, '').toLowerCase();
    setItems((prev) =>
      prev.map((item) => {
        if (item.blake3?.replace(/^0x/, '').toLowerCase() !== normalizedHash) {
          return item;
        }
        return { ...item, matchedOffchain: matched };
      })
    );
  }, []);

  const hasPendingUploads = useMemo(
    () => items.some((item) => item.uploadStatus !== 'uploaded'),
    [items]
  );

  const isProcessing = useMemo(
    () => items.some((item) => item.hashStatus === 'processing' || item.uploadStatus === 'uploading'),
    [items]
  );

  const toCachePayload = useCallback(() => items.map(buildCachedItem), [items]);

  return {
    items,
    addFiles,
    removeItem,
    reset,
    uploadItem,
    uploadAll,
    markAsset,
    updateVerificationStatus,
    markMatched,
    messages,
    dismissMessage,
    primaryHashAlgorithm,
    secondaryHashAlgorithm,
    hasPendingUploads,
    isProcessing,
    toCachePayload
  };
};
