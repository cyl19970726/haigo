import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDER_MEDIA_CATEGORIES, ORDER_MEDIA_VERIFICATION_STATUSES } from '@shared/config';
import type { OrderMediaAsset } from '@shared/dto/orders';
import { useInboundMediaManager } from './useInboundMediaManager';
import { hashFileBlake3 } from '../../../lib/crypto/blake3';
import { hashFileKeccak256 } from '../../../lib/crypto/keccak';
import { uploadMediaAsset } from '../../../lib/api/media';

vi.mock('../../../lib/crypto/blake3', () => ({
  hashFileBlake3: vi.fn()
}));

vi.mock('../../../lib/crypto/keccak', () => ({
  hashFileKeccak256: vi.fn()
}));

vi.mock('../../../lib/api/media', () => ({
  uploadMediaAsset: vi.fn()
}));

const hashFileBlake3Mock = vi.mocked(hashFileBlake3);
const hashFileKeccak256Mock = vi.mocked(hashFileKeccak256);
const uploadMediaAssetMock = vi.mocked(uploadMediaAsset);

describe('useInboundMediaManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hashFileBlake3Mock.mockResolvedValue('abc123'.padEnd(64, '0'));
    hashFileKeccak256Mock.mockResolvedValue('def456'.padEnd(64, '1'));
    uploadMediaAssetMock.mockResolvedValue({
      hashValue: 'abc123'.padEnd(64, '0'),
      hashAlgorithm: 'BLAKE3',
      stage: 'inbound',
      category: ORDER_MEDIA_CATEGORIES.INBOUND_PHOTO,
      verificationStatus: ORDER_MEDIA_VERIFICATION_STATUSES.PENDING
    } satisfies Partial<OrderMediaAsset> as OrderMediaAsset);
  });

  it('rejects unsupported mime types', async () => {
    const file = new File(['invalid'], 'note.txt', { type: 'text/plain' });
    const { result } = renderHook(() => useInboundMediaManager({ recordUid: 'order-1' }));

    act(() => {
      result.current.addFiles([file]);
    });

    await waitFor(() => expect(result.current.messages.length).toBeGreaterThan(0));
    expect(result.current.messages[0].message).toContain('未被允许上传');
  });

  it('hashes and uploads media files', async () => {
    const blob = new Uint8Array([1, 2, 3, 4]);
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    const { result } = renderHook(() => useInboundMediaManager({ recordUid: 'order-2' }));

    await act(async () => {
      result.current.addFiles([file]);
    });

    await waitFor(() => expect(result.current.items[0]?.blake3).toBeDefined());

    await act(async () => {
      await result.current.uploadItem(result.current.items[0].id);
    });

    expect(uploadMediaAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recordUid: 'order-2',
        hashValue: expect.any(String),
        stage: 'inbound'
      })
    );
    expect(result.current.items[0].uploadStatus).toBe('uploaded');
  });

  it('throttles repeated upload attempts after failure', async () => {
    const blob = new Uint8Array([5, 6, 7, 8]);
    const file = new File([blob], 'retry.jpg', { type: 'image/jpeg' });
    const { result } = renderHook(() => useInboundMediaManager({ recordUid: 'order-3' }));

    await act(async () => {
      result.current.addFiles([file]);
    });

    await waitFor(() => expect(result.current.items[0]?.hashStatus).toBe('ready'));

    uploadMediaAssetMock.mockRejectedValueOnce(new Error('upload failed'));

    await act(async () => {
      await result.current.uploadItem(result.current.items[0].id);
    });

    uploadMediaAssetMock.mockClear();

    await act(async () => {
      await result.current.uploadItem(result.current.items[0].id);
    });

    expect(uploadMediaAssetMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.messages.length).toBeGreaterThan(0);
      expect(result.current.messages[result.current.messages.length - 1]?.message).toContain('请稍候再重试上传');
    });
  });
});
