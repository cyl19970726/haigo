'use client';

import type { OrderMediaStage, OrderMediaVerificationStatus } from '@shared/dto/orders';

export interface CachedMediaItem {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  stage: OrderMediaStage;
  category: string;
  hashValue?: string;
  crossCheckHashValue?: string;
  matchedOffchain?: boolean;
  verificationStatus?: OrderMediaVerificationStatus;
  verificationAttempts?: number;
  updatedAt: number;
  blob?: Blob;
}

export interface InboundMediaDraft {
  recordUid: string;
  items: CachedMediaItem[];
  logistics?: {
    carrier?: string;
    trackingNumber?: string;
    notes?: string;
  };
  savedAt: number;
}

const DB_NAME = 'haigo-media-drafts';
const STORE_NAME = 'inbound-media';

const memoryStore = new Map<string, InboundMediaDraft>();

const openDb = async (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return null;
  }

  return await new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'recordUid' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.warn('[HaiGo] IndexedDB unavailable for media drafts', request.error);
      resolve(null);
    };
  });
};

export const saveInboundMediaDraft = async (draft: InboundMediaDraft): Promise<void> => {
  const payload: InboundMediaDraft = {
    ...draft,
    savedAt: Date.now()
  };

  const db = await openDb();
  if (!db) {
    memoryStore.set(draft.recordUid, payload);
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(payload);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      console.warn('[HaiGo] Failed to persist media draft to IndexedDB, falling back to memory', transaction.error);
      memoryStore.set(draft.recordUid, payload);
      resolve();
    };
  });
};

export const loadInboundMediaDraft = async (recordUid: string): Promise<InboundMediaDraft | null> => {
  const db = await openDb();
  if (!db) {
    return memoryStore.get(recordUid) ?? null;
  }

  return await new Promise<InboundMediaDraft | null>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(recordUid);

    request.onsuccess = () => {
      resolve((request.result as InboundMediaDraft | undefined) ?? null);
    };

    request.onerror = () => {
      console.warn('[HaiGo] Failed to load media draft from IndexedDB', request.error);
      resolve(memoryStore.get(recordUid) ?? null);
    };
  });
};

export const clearInboundMediaDraft = async (recordUid: string): Promise<void> => {
  const db = await openDb();
  memoryStore.delete(recordUid);

  if (!db) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(recordUid);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      console.warn('[HaiGo] Failed to clear media draft from IndexedDB', transaction.error);
      resolve();
    };
  });
};
