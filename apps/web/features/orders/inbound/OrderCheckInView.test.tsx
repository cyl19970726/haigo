import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORDER_MEDIA_CATEGORIES, ORDER_MEDIA_VERIFICATION_STATUSES } from '@shared/config';
import type { OrderDetailDto, OrderMediaAsset } from '@shared/dto/orders';
import { OrderCheckInView } from './OrderCheckInView';
import { useWalletContext } from '../../../lib/wallet/context';
import { useInboundMediaManager } from './useInboundMediaManager';
import { fetchOrderDetail } from '../../../lib/api/orders';
import { requestMediaReverification } from '../../../lib/api/media';
import {
  loadInboundMediaDraft,
  saveInboundMediaDraft,
  clearInboundMediaDraft
} from '../../../lib/storage/inbound-media-cache';

vi.mock('../../../lib/api/orders', () => ({
  fetchOrderDetail: vi.fn()
}));

vi.mock('../../../lib/api/media', () => ({
  requestMediaReverification: vi.fn()
}));

vi.mock('../../../lib/storage/inbound-media-cache', () => ({
  loadInboundMediaDraft: vi.fn(),
  saveInboundMediaDraft: vi.fn(),
  clearInboundMediaDraft: vi.fn()
}));

vi.mock('../../../lib/wallet/context', () => ({
  useWalletContext: vi.fn()
}));

vi.mock('../../../lib/wallet/network-guard', () => ({
  NetworkGuard: ({ children }: { children: ReactNode }) => <>{children}</>
}));

vi.mock('./useInboundMediaManager', () => ({
  useInboundMediaManager: vi.fn()
}));

const walletContextMock = vi.mocked(useWalletContext);
const mediaManagerMock = vi.mocked(useInboundMediaManager);
const fetchOrderDetailMock = vi.mocked(fetchOrderDetail);
const requestMediaReverificationMock = vi.mocked(requestMediaReverification);
const loadDraftMock = vi.mocked(loadInboundMediaDraft);
const saveDraftMock = vi.mocked(saveInboundMediaDraft);
const clearDraftMock = vi.mocked(clearInboundMediaDraft);

const buildOrderDetail = (): OrderDetailDto => ({
  recordUid: 'order-42',
  orderId: 42,
  status: 'CREATED',
  warehouseAddress: '0xwarehouse',
  pricing: {
    amountSubunits: 100,
    insuranceFeeSubunits: 0,
    platformFeeSubunits: 0,
    totalSubunits: 100,
    currency: 'APT',
    precision: 100_000_000
  },
  logistics: { carrier: 'SF', trackingNumber: 'ABC123' },
  createdAt: new Date().toISOString(),
  timeline: []
});

const buildMediaManager = () => {
  const asset: OrderMediaAsset = {
    id: 'asset-1',
    hashValue: 'a'.repeat(64),
    hashAlgorithm: 'BLAKE3',
    stage: 'inbound',
    category: ORDER_MEDIA_CATEGORIES.INBOUND_PHOTO,
    verificationStatus: ORDER_MEDIA_VERIFICATION_STATUSES.PENDING
  };

  return {
    items: [
      {
        id: 'item-1',
        fileName: 'photo.jpg',
        fileSize: 1024,
        stage: 'inbound',
        category: ORDER_MEDIA_CATEGORIES.INBOUND_PHOTO,
        blake3: asset.hashValue,
        keccak256: 'b'.repeat(64),
        hashStatus: 'ready',
        hashError: undefined,
        uploadStatus: 'uploaded',
        uploadError: undefined,
        uploadProgress: 1,
        verificationStatus: ORDER_MEDIA_VERIFICATION_STATUSES.PENDING,
        verificationAttempts: 0,
        matchedOffchain: false,
        lastVerificationAt: undefined,
        lastErrorAt: undefined,
        retries: 0,
        response: asset,
        previewUrl: undefined
      }
    ],
    addFiles: vi.fn(),
    removeItem: vi.fn(),
    reset: vi.fn(),
    uploadItem: vi.fn(),
    uploadAll: vi.fn().mockResolvedValue([asset]),
    markAsset: vi.fn(),
    updateVerificationStatus: vi.fn(),
    markMatched: vi.fn(),
    messages: [],
    dismissMessage: vi.fn(),
    primaryHashAlgorithm: 'BLAKE3',
    secondaryHashAlgorithm: 'KECCAK256',
    hasPendingUploads: false,
    isProcessing: false,
    toCachePayload: vi.fn(() => [])
  };
};

describe('OrderCheckInView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const buildSimple = vi.fn().mockResolvedValue({ payload: 'txn' });
    const simulateSimple = vi.fn().mockResolvedValue([{ success: true }]);
    const getTransactionByHash = vi.fn().mockResolvedValue({ type: 'user_transaction', success: true, events: [] });

    walletContextMock.mockReturnValue({
      status: 'connected',
      availableWallets: [{ name: 'Petra', icon: '' }],
      connect: vi.fn().mockResolvedValue(undefined),
      accountAddress: '0x1',
      signAndSubmitTransaction: vi.fn().mockResolvedValue({ hash: '0x123' }),
      networkStatus: { expected: 'testnet', actual: 'testnet', isMatch: true, lastChecked: Date.now() },
      aptos: {
        transaction: {
          build: { simple: buildSimple },
          simulate: { simple: simulateSimple },
          getTransactionByHash
        }
      }
    } as any);

    fetchOrderDetailMock.mockResolvedValue(buildOrderDetail());
    requestMediaReverificationMock.mockResolvedValue({ status: ORDER_MEDIA_VERIFICATION_STATUSES.PENDING });
    loadDraftMock.mockResolvedValue(null);
    saveDraftMock.mockResolvedValue(undefined);
    clearDraftMock.mockResolvedValue(undefined);

    mediaManagerMock.mockReturnValue(buildMediaManager());
  });

  it('requires logistics info before advancing', async () => {
    render(<OrderCheckInView recordUid="order-42" />);

    const nextButton = await screen.findByRole('button', { name: 'Next: Upload media' });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('Please provide the carrier information')).toBeInTheDocument();
    });
  });

  it('submits transaction and refreshes order detail', async () => {
    const manager = buildMediaManager();
    mediaManagerMock.mockReturnValue(manager as any);

    render(<OrderCheckInView recordUid="order-42" />);

    fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'SF Express' } });
    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'TRACK-001' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next: Upload media' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next: Review & submit' }));

    fireEvent.click(screen.getByRole('button', { name: 'Submit inbound on-chain' }));

    await waitFor(() => {
      expect(screen.getByText('Inbound submission succeeded on-chain. The timeline will refresh shortly.')).toBeInTheDocument();
    });

    expect(manager.uploadAll).toHaveBeenCalled();
    const context = walletContextMock.mock.results[0].value;
    expect(context.signAndSubmitTransaction).toHaveBeenCalled();
    expect(fetchOrderDetailMock).toHaveBeenCalledWith('order-42');
    expect(clearDraftMock).toHaveBeenCalledWith('order-42');
  });

  it('increments verification attempts only once per manual re-check', async () => {
    const manager = buildMediaManager();
    mediaManagerMock.mockReturnValue(manager as any);

    const asset = {
      ...manager.items[0].response!,
      verificationStatus: ORDER_MEDIA_VERIFICATION_STATUSES.VERIFIED,
      matchedOffchain: true
    } as OrderMediaAsset;

    requestMediaReverificationMock.mockResolvedValue({
      asset,
      status: ORDER_MEDIA_VERIFICATION_STATUSES.VERIFIED
    });

    render(<OrderCheckInView recordUid="order-42" />);

    fireEvent.change(screen.getByLabelText('Carrier'), { target: { value: 'SF Express' } });
    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'TRACK-002' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next: Upload media' }));

    const reverifyButton = await screen.findByRole('button', { name: 'Retry verification' });
    fireEvent.click(reverifyButton);

    await waitFor(() => {
      expect(manager.updateVerificationStatus).toHaveBeenCalledWith(
        manager.items[0].blake3,
        ORDER_MEDIA_VERIFICATION_STATUSES.RECHECKING
      );
    });

    await waitFor(() => {
      expect(manager.updateVerificationStatus).toHaveBeenCalledWith(
        manager.items[0].blake3,
        ORDER_MEDIA_VERIFICATION_STATUSES.VERIFIED,
        expect.objectContaining({ increment: false })
      );
    });

    const incrementFalseCalls = manager.updateVerificationStatus.mock.calls.filter(([, , options]) => options?.increment === false);
    expect(incrementFalseCalls).toHaveLength(1);

    const noOptionsCalls = manager.updateVerificationStatus.mock.calls.filter(([, , options]) => options === undefined);
    expect(noOptionsCalls).toHaveLength(1);
  });
});
