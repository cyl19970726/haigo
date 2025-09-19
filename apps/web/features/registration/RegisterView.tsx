'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent
} from 'react';
import { Ed25519PublicKey, type SimpleTransaction } from '@aptos-labs/ts-sdk';
import type { AccountProfile } from '@shared/dto/registry';
import { APTOS_MODULE_ADDRESS, REGISTRY_MODULE } from '@shared/config/aptos';
import { uploadIdentityDocument, fetchAccountProfile } from '../../lib/api/registration';
import { hashFileBlake3 } from '../../lib/crypto/blake3';
import { NetworkGuard } from '../../lib/wallet/network-guard';
import { useWalletContext } from '../../lib/wallet/context';
import { useRouter } from 'next/navigation';
import { ensureSession } from '../../lib/session/ensureSession';

const ROLE_OPTIONS = [
  { value: 'seller', label: 'Seller' },
  { value: 'warehouse', label: 'Warehouse' }
] as const;

type RoleValue = (typeof ROLE_OPTIONS)[number]['value'];

const ROLE_DESCRIPTIONS: Record<RoleValue, string> = {
  seller: 'Sellers should provide business registration paperwork or proof of cross-border trade qualification.',
  warehouse: 'Warehouse operators should upload facility compliance certificates or insurance coverage documentation.'
};

interface SelectedFileMeta {
  name: string;
  mime: string;
  sizeBytes: number;
  hash: string;
}

interface PendingProfileCache {
  role: RoleValue;
  hash: string;
  storagePath: string;
  recordUid: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
  profileUri?: string;
  notes?: string;
}

interface GasEstimate {
  gasUsed: number;
  gasUnitPrice: number;
  maxGasAmount: number;
  estimatedFee: number;
  transactionSize: number;
}

type SimulationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; estimate: GasEstimate; transaction: SimpleTransaction }
  | { status: 'error'; message: string };

type TransactionStage = 'idle' | 'submitting' | 'pending' | 'success' | 'failed';

interface TransactionState {
  stage: TransactionStage;
  hash?: string;
  error?: string;
  explorerUrl?: string;
}

const BYTES_IN_MB = 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * BYTES_IN_MB;
const MAX_DOCUMENT_BYTES = 200 * BYTES_IN_MB;
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const APT_USD_RATE = Number(process.env.NEXT_PUBLIC_APT_USD_RATE ?? '0');
const EXPLORER_BASE_URL = 'https://explorer.aptoslabs.com';

const STATUS_BADGE_CLASS: Record<string, string> = {
  disconnected: 'haigo-status haigo-status--disconnected',
  connecting: 'haigo-status haigo-status--connecting',
  connected: 'haigo-status haigo-status--connected'
};

const formatBytes = (bytes: number) => {
  if (bytes < BYTES_IN_MB) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / BYTES_IN_MB).toFixed(2)} MB`;
};

const formatApt = (amount: number) => amount.toFixed(6);

const truncateAddress = (address?: string) => {
  if (!address) return '';
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
};

const getCacheKey = (address: string) => `haigo:registration:${address}`;

const loadCache = (address: string): PendingProfileCache | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(getCacheKey(address));
    if (!stored) return null;
    return JSON.parse(stored) as PendingProfileCache;
  } catch (error) {
    console.warn('[HaiGo] Failed to parse cached registration payload', error);
    return null;
  }
};

const saveCache = (address: string, payload?: PendingProfileCache | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (!payload) {
      window.sessionStorage.removeItem(getCacheKey(address));
      return;
    }
    window.sessionStorage.setItem(getCacheKey(address), JSON.stringify(payload));
  } catch (error) {
    console.warn('[HaiGo] Unable to persist registration cache', error);
  }
};

const buildExplorerUrl = (hash: string, network: string) => `${EXPLORER_BASE_URL}/txn/${hash}?network=${network}`;

export function RegisterView() {
  const router = useRouter();
  const {
    status,
    accountAddress,
    accountPublicKey,
    walletName,
    availableWallets,
    connect,
    disconnect,
    networkStatus,
    refreshNetworkStatus,
    connectionError,
    aptos,
    signAndSubmitTransaction,
    signMessage
  } = useWalletContext();

  type SignAndSubmitTransactionInput = Parameters<typeof signAndSubmitTransaction>[0];
  type RegisterTransactionInput = SignAndSubmitTransactionInput & { sender: string };

  const [role, setRole] = useState<RoleValue>('seller');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileMeta, setFileMeta] = useState<SelectedFileMeta | null>(null);
  const [isHashing, setIsHashing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ recordUid: string; path: string; hash: string } | null>(null);
  const [cachedProfile, setCachedProfile] = useState<PendingProfileCache | null>(null);
  const [profileUri, setProfileUri] = useState('');
  const [notes, setNotes] = useState('');
  const [accountInfo, setAccountInfo] = useState<AccountProfile | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [simulationState, setSimulationState] = useState<SimulationState>({ status: 'idle' });
  const [transactionState, setTransactionState] = useState<TransactionState>({ stage: 'idle' });
  const [redirectAnnounce, setRedirectAnnounce] = useState<string | null>(null);
  const [showRedirectCta, setShowRedirectCta] = useState(false);

  const hashingRun = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeHash = uploadResult?.hash ?? cachedProfile?.hash ?? null;

  // Hydrate cached upload + reset form when wallet changes
  useEffect(() => {
    if (!accountAddress) {
      setCachedProfile(null);
      setUploadResult(null);
      setFileMeta(null);
      setProfileUri('');
      setNotes('');
      return;
    }

    const cached = loadCache(accountAddress);
    if (cached) {
      setRole(cached.role);
      setCachedProfile(cached);
      setUploadResult({ recordUid: cached.recordUid, path: cached.storagePath, hash: cached.hash });
      setFileMeta({ name: cached.fileName, mime: cached.mime, sizeBytes: cached.sizeBytes, hash: cached.hash });
      setProfileUri(cached.profileUri ?? '');
      setNotes(cached.notes ?? '');
    } else {
      setCachedProfile(null);
      setUploadResult(null);
      setFileMeta(null);
      setProfileUri('');
      setNotes('');
    }
  }, [accountAddress]);

  // Load current registration state from BFF
  useEffect(() => {
    if (!accountAddress) {
      setAccountInfo(null);
      setAccountError(null);
      return;
    }

    let cancelled = false;
    setAccountLoading(true);
    fetchAccountProfile(accountAddress)
      .then((profile) => {
        if (!cancelled) {
          setAccountInfo(profile);
          setAccountError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAccountInfo(null);
          setAccountError(error instanceof Error ? error.message : 'Unable to load registration status');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAccountLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountAddress]);

  // Persist cache updates
  useEffect(() => {
    if (!accountAddress) return;
    saveCache(accountAddress, cachedProfile);
  }, [accountAddress, cachedProfile]);

  // Clear downstream states when role or hash changes
  useEffect(() => {
    setSimulationState({ status: 'idle' });
    setTransactionState({ stage: 'idle' });
  }, [role, activeHash]);

  const handleRoleChange = (value: RoleValue) => {
    setRole(value);
    setCachedProfile((prev) => (prev ? { ...prev, role: value } : prev));
  };

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return 'Unsupported file type. Upload PDF, JPG, or PNG files only.';
    }

    const isImage = file.type.startsWith('image/');
    const limit = isImage ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (file.size > limit) {
      return isImage ? 'Images must be 15MB or smaller.' : 'Documents must be 200MB or smaller.';
    }

    return null;
  };

  const computeHash = useCallback(async (file: File) => {
    hashingRun.current += 1;
    const currentRun = hashingRun.current;
    setIsHashing(true);
    try {
      const hash = await hashFileBlake3(file);
      if (currentRun === hashingRun.current) {
        setFileMeta({ name: file.name, mime: file.type, sizeBytes: file.size, hash });
        setFileError(null);
      }
    } catch (error) {
      if (currentRun === hashingRun.current) {
        setFileError('Failed to compute file hash. Try again.');
        setFileMeta(null);
      }
    } finally {
      if (currentRun === hashingRun.current) {
        setIsHashing(false);
      }
    }
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const [file] = Array.from(files);
      const validationMessage = validateFile(file);
      if (validationMessage) {
        setFileError(validationMessage);
        setFileMeta(null);
        return;
      }

      setUploadResult(null);
      setCachedProfile(null);
      setSelectedFile(file);
      setUploadError(null);
      setSimulationState({ status: 'idle' });
      setTransactionState({ stage: 'idle' });
      await computeHash(file);
    },
    [computeHash]
  );

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      await handleFiles(event.dataTransfer?.files ?? null);
    },
    [handleFiles]
  );

  const onFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      await handleFiles(event.target.files);
    },
    [handleFiles]
  );

  const onBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const onProfileUriChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setProfileUri(value);
    setCachedProfile((prev) => (prev ? { ...prev, profileUri: value || undefined } : prev));
  };

  const onNotesChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setNotes(value);
    setCachedProfile((prev) => (prev ? { ...prev, notes: value || undefined } : prev));
  };

  const clearCachedUpload = () => {
    setCachedProfile(null);
    setUploadResult(null);
    setFileMeta(null);
    setSelectedFile(null);
    setSimulationState({ status: 'idle' });
    setTransactionState({ stage: 'idle' });
    if (accountAddress) {
      saveCache(accountAddress, null);
    }
  };

  const alreadyRegistered = Boolean(accountInfo?.profileHash?.value);

  const canSubmitUpload =
    status === 'connected' &&
    networkStatus.isMatch &&
    !alreadyRegistered &&
    (Boolean(selectedFile && fileMeta?.hash) || Boolean(cachedProfile || uploadResult));

  const handleFormSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!accountAddress) {
      setUploadError('Connect your wallet before uploading documentation.');
      return;
    }

    if (alreadyRegistered) {
      setUploadError('This address is already registered.');
      return;
    }

    if (cachedProfile && !selectedFile) {
      setUploadResult({
        recordUid: cachedProfile.recordUid,
        path: cachedProfile.storagePath,
        hash: cachedProfile.hash
      });
      return;
    }

    if (!selectedFile || !fileMeta?.hash) {
      setFileError('Upload a valid document before continuing.');
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    try {
      const response = await uploadIdentityDocument({
        file: selectedFile,
        address: accountAddress,
        role,
        hash: fileMeta.hash
      });

      if (response.hash.value.toLowerCase() !== fileMeta.hash.toLowerCase()) {
        throw new Error('Hash mismatch between client and server.');
      }

      const cachePayload: PendingProfileCache = {
        role,
        hash: fileMeta.hash,
        storagePath: response.path,
        recordUid: response.recordUid,
        fileName: fileMeta.name,
        mime: fileMeta.mime,
        sizeBytes: fileMeta.sizeBytes,
        uploadedAt: new Date().toISOString(),
        profileUri: profileUri || undefined,
        notes: notes || undefined
      };

      setCachedProfile(cachePayload);
      setUploadResult({ recordUid: response.recordUid, path: response.path, hash: response.hash.value });
      setSelectedFile(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to upload documentation.');
    } finally {
      setIsUploading(false);
    }
  };

  const registerFunction = useMemo(
    () =>
      `${APTOS_MODULE_ADDRESS}::registry::${role === 'seller' ? 'register_seller' : 'register_warehouse'}` as `${string}::${string}::${string}`,
    [role]
  );

  const buildRegisterTransactionInput = useCallback(
    (hashValue: string): RegisterTransactionInput => {
      if (!accountAddress) {
        throw new Error('Connect your wallet before submitting the transaction.');
      }

      return {
        sender: accountAddress,
        data: {
          function: registerFunction,
          typeArguments: [],
          functionArguments: [REGISTRY_MODULE.HASH_ALGORITHM_BLAKE3, hashValue]
        }
      } satisfies RegisterTransactionInput;
    },
    [accountAddress, registerFunction]
  );

  const buildRegisterTransaction = useCallback(
    async (hashValue: string): Promise<SimpleTransaction> => {
      const transactionInput = buildRegisterTransactionInput(hashValue);
      return aptos.transaction.build.simple(transactionInput);
    },
    [aptos, buildRegisterTransactionInput]
  );

  const simulateRegistration = useCallback(async () => {
    if (!accountAddress) {
      setSimulationState({ status: 'error', message: 'Connect your wallet before simulating.' });
      return;
    }

    if (!accountPublicKey) {
      setSimulationState({ status: 'error', message: 'Wallet did not expose a public key for simulation.' });
      return;
    }

    if (!activeHash) {
      setSimulationState({ status: 'error', message: 'Upload documentation through HaiGo before estimating gas.' });
      return;
    }

    setSimulationState({ status: 'loading' });
    try {
      const transaction = await buildRegisterTransaction(activeHash);
      const signerPublicKey = new Ed25519PublicKey(accountPublicKey);
      const simulations = await aptos.transaction.simulate.simple({
        signerPublicKey,
        transaction
      });

      const [simulation] = simulations;
      if (!simulation) {
        throw new Error('Simulation returned no result.');
      }

      const success = (simulation as any).success ?? (simulation as any).execution_success ?? true;
      if (!success) {
        const vmStatus = (simulation as any).vm_status ?? (simulation as any).vmStatus ?? 'Simulation failed.';
        throw new Error(vmStatus);
      }

      const gasUsed = Number((simulation as any).gas_used ?? (simulation as any).gasUsed ?? 0);
      const gasUnitPrice = Number((simulation as any).gas_unit_price ?? (simulation as any).gasUnitPrice ?? 0);
      const maxGasAmount = Number((simulation as any).max_gas_amount ?? (simulation as any).maxGasAmount ?? 0);
      const transactionSize = Number((simulation as any).bytes ?? (simulation as any).transaction_size ?? 0);
      const basis = gasUsed || maxGasAmount;
      const estimatedFee = (gasUnitPrice * basis) / 1e8;

      setSimulationState({
        status: 'success',
        estimate: {
          gasUsed,
          gasUnitPrice,
          maxGasAmount,
          transactionSize,
          estimatedFee
        },
        transaction
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to simulate transaction.';
      setSimulationState({ status: 'error', message });
    }
  }, [accountAddress, accountPublicKey, activeHash, aptos, buildRegisterTransaction]);

  const pollTransaction = useCallback(
    async (hash: string) => {
      const maxAttempts = 8;
      let delay = 1000;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const txn = await aptos.transaction.getTransactionByHash({ transactionHash: hash });
          if ((txn as any)?.type === 'user_transaction') {
            if ((txn as any)?.success === false) {
              throw new Error((txn as any)?.vm_status ?? 'Transaction failed on-chain.');
            }
            return;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (!message.includes('not found') && !message.includes('404')) {
            throw error;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 8000);
      }

      throw new Error('Transaction confirmation timed out. Check the explorer for final status.');
    },
    [aptos]
  );

  const refreshAccountInfo = useCallback(async () => {
    if (!accountAddress) return;
    try {
      setAccountLoading(true);
      const profile = await fetchAccountProfile(accountAddress);
      setAccountInfo(profile);
      setAccountError(null);
    } catch (error) {
      setAccountInfo(null);
      setAccountError(error instanceof Error ? error.message : 'Unable to refresh registration status');
    } finally {
      setAccountLoading(false);
    }
  }, [accountAddress]);

  const submitRegistration = useCallback(async () => {
    if (!accountAddress) {
      setTransactionState({ stage: 'failed', error: 'Connect your wallet before submitting.' });
      return;
    }

    if (!activeHash) {
      setTransactionState({ stage: 'failed', error: 'Upload documentation before signing the transaction.' });
      return;
    }

    setTransactionState({ stage: 'submitting' });
    try {
      const transactionInput = buildRegisterTransactionInput(activeHash);

      const transaction =
        simulationState.status === 'success'
          ? simulationState.transaction
          : await buildRegisterTransaction(activeHash);

      const result = await signAndSubmitTransaction(transactionInput);
      const txnHash =
        typeof result === 'string'
          ? result
          : result?.hash ??
            (typeof (result as any)?.transactionHash === 'string' ? (result as any).transactionHash : undefined) ??
            (typeof (result as any)?.txnHash === 'string' ? (result as any).txnHash : undefined) ??
            (typeof (result as any)?.result?.hash === 'string' ? (result as any).result.hash : undefined);

      if (!txnHash) {
        throw new Error('Wallet did not return a transaction hash.');
      }

      const explorerUrl = buildExplorerUrl(txnHash, networkStatus.expected);
      setTransactionState({ stage: 'pending', hash: txnHash, explorerUrl });

      try {
        await pollTransaction(txnHash);
        setTransactionState({ stage: 'success', hash: txnHash, explorerUrl });

        const immediateProfile: AccountProfile = {
          address: accountAddress,
          role,
          profileHash: { algorithm: 'blake3', value: activeHash },
          profileUri: profileUri || cachedProfile?.profileUri,
          registeredAt: new Date().toISOString(),
          orderCount: accountInfo?.orderCount
        };
        setAccountInfo(immediateProfile);
        void refreshAccountInfo();
      } catch (pollError) {
        setTransactionState({
          stage: 'failed',
          hash: txnHash,
          explorerUrl,
          error: pollError instanceof Error ? pollError.message : 'Failed to confirm transaction.'
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction submission failed.';
      const normalized = message.toLowerCase();
      const friendly = normalized.includes('reject')
        ? 'Signature request was declined in your wallet.'
        : message;
      setTransactionState({ stage: 'failed', error: friendly });
    }
  }, [
    accountAddress,
    activeHash,
    simulationState,
    buildRegisterTransaction,
    buildRegisterTransactionInput,
    signAndSubmitTransaction,
    networkStatus.expected,
    pollTransaction,
    refreshAccountInfo,
    role,
    profileUri,
    cachedProfile,
    accountInfo
  ]);

  const connectionDescription = useMemo(() => {
    if (status === 'connecting') return 'Connecting to wallet…';
    if (status === 'connected' && accountAddress) {
      return `${walletName ?? 'Wallet'} connected`;
    }
    return 'Select a wallet to connect';
  }, [status, accountAddress, walletName]);

  const aptFeeEstimate = simulationState.status === 'success' ? simulationState.estimate.estimatedFee : null;
  const aptFeeUsd = aptFeeEstimate && APT_USD_RATE > 0 ? aptFeeEstimate * APT_USD_RATE : null;

  const isSubmitted = ['submitting', 'pending', 'success', 'failed'].includes(transactionState.stage);
  const isPending = ['pending', 'success'].includes(transactionState.stage);
  const isExecuted = transactionState.stage === 'success';

  // Auto-redirect to role dashboard after on-chain success and profile available
  useEffect(() => {
    if (transactionState.stage !== 'success') return;

    const timer = setTimeout(() => setShowRedirectCta(true), 60_000);

    if (accountInfo?.role && accountAddress) {
      const path = accountInfo.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse';
      void (async () => {
        try {
          await ensureSession(accountAddress, signMessage ?? undefined, accountPublicKey ?? undefined);
          setRedirectAnnounce('Registration succeeded, redirecting to your dashboard…');
          setTimeout(() => router.push(path), 400);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Automatic login failed. Use the dashboard button below.';
          setRedirectAnnounce(message);
          setShowRedirectCta(true);
        }
      })();
    }

    return () => clearTimeout(timer);
  }, [transactionState.stage, accountInfo?.role, accountAddress, router, signMessage]);

  return (
    <main className="register-shell" aria-live="polite">
      <header className="register-shell__header">
        <h1 className="register-shell__title">Register your HaiGo identity</h1>
        <p className="register-shell__subtitle">
          Connect your Aptos wallet, choose your role, upload verification documents, and keep the metadata ready for on-chain registration.
        </p>
      </header>

      <section className="wallet-panel" aria-label="Wallet status">
        <div className="wallet-panel__summary">
          <span className={STATUS_BADGE_CLASS[status] ?? STATUS_BADGE_CLASS.disconnected} aria-hidden="true" />
          <div>
            <div className="wallet-panel__status">{connectionDescription}</div>
            {accountAddress ? (
              <button
                type="button"
                className="wallet-panel__address"
                onClick={() => accountAddress && navigator.clipboard?.writeText(accountAddress)}
              >
                {truncateAddress(accountAddress)} (copy)
              </button>
            ) : (
              <span className="wallet-panel__placeholder">Wallet not connected</span>
            )}
          </div>
        </div>
        {connectionError && (
          <p className="wallet-panel__error" role="alert">
            {connectionError}
          </p>
        )}
        <div className="wallet-panel__actions">
          <div className="wallet-panel__network">
            <span className="wallet-panel__network-label">Network</span>
            <span className={`wallet-panel__network-badge${networkStatus.isMatch ? '' : ' wallet-panel__network-badge--warning'}`}>
              {networkStatus.actual ?? 'Unknown'}
            </span>
            {!networkStatus.isMatch && (
              <button
                type="button"
                className="wallet-panel__retry"
                onClick={() => refreshNetworkStatus(3)}
              >
                Retry
              </button>
            )}
          </div>
          <div className="wallet-panel__buttons" role="group" aria-label="Available wallets">
            {availableWallets.map((walletOption) => (
              <button
                key={walletOption.name}
                type="button"
                className="wallet-panel__button"
                disabled={status === 'connecting'}
                onClick={() => void connect(walletOption.name)}
              >
                {walletOption.name}
              </button>
            ))}
            {status === 'connected' && (
              <button type="button" className="wallet-panel__button wallet-panel__button--secondary" onClick={() => void disconnect()}>
                Disconnect
              </button>
            )}
          </div>
        </div>
      </section>

      {accountLoading && (
        <section className="account-status" aria-busy="true">
          <p>Checking existing registration…</p>
        </section>
      )}

      {!accountLoading && accountInfo && (
        <section className="account-status account-status--success" role="status">
          <h2>Identity already registered</h2>
          <dl>
            <div>
              <dt>Role</dt>
              <dd>{accountInfo.role}</dd>
            </div>
            <div>
              <dt>Profile hash</dt>
              <dd>{accountInfo.profileHash.value}</dd>
            </div>
            <div>
              <dt>Registered at</dt>
              <dd>{new Date(accountInfo.registeredAt).toLocaleString()}</dd>
            </div>
          </dl>
        </section>
      )}

      {accountError && !accountInfo && (
        <section className="account-status account-status--error" role="alert">
          <p>{accountError}</p>
        </section>
      )}

      <NetworkGuard
        fallback={
          <section className="network-warning" role="alert">
            <h2>Switch your wallet network</h2>
            <p>
              Expected network: <strong>{networkStatus.expected}</strong>. Current wallet network:{' '}
              <strong>{networkStatus.actual ?? 'unknown'}</strong>.
            </p>
            <p>Update the network in your wallet, then press retry to continue.</p>
            <button type="button" className="network-warning__button" onClick={() => refreshNetworkStatus(3)}>
              Retry network check
            </button>
          </section>
        }
      >
        <>
          <form className="register-form" onSubmit={handleFormSubmit}>
            <fieldset className="register-form__roles">
              <legend>Select your identity</legend>
              <div className="register-form__tabs" role="tablist">
                {ROLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    id={`role-tab-${option.value}`}
                    type="button"
                    role="tab"
                    aria-selected={role === option.value}
                    aria-controls={`role-panel-${option.value}`}
                    className={`register-form__tab${role === option.value ? ' register-form__tab--active' : ''}`}
                    onClick={() => handleRoleChange(option.value)}
                    disabled={alreadyRegistered}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="register-form__role-info">
                {ROLE_OPTIONS.map((option) => (
                  <div
                    key={option.value}
                    role="tabpanel"
                    id={`role-panel-${option.value}`}
                    aria-labelledby={`role-tab-${option.value}`}
                    className="register-form__role-panel"
                    hidden={role !== option.value}
                  >
                    {ROLE_DESCRIPTIONS[option.value]}
                  </div>
                ))}
              </div>
            </fieldset>

            <fieldset className="register-form__upload" aria-describedby="upload-hint">
              <legend>Upload verification document</legend>
              <p id="upload-hint" className="register-form__hint">
                Upload a PDF, JPG, or PNG (images ≤ 15MB, documents ≤ 200MB).
              </p>
              <div
                className="register-form__dropzone"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={alreadyRegistered ? undefined : onDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (alreadyRegistered) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onBrowseClick();
                  }
                }}
                aria-label="Upload verification document"
                aria-invalid={fileError ? 'true' : undefined}
                aria-disabled={alreadyRegistered}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="register-form__file-input"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={onFileInputChange}
                  disabled={alreadyRegistered}
                />
                <p className="register-form__dropzone-text">
                  Drag & drop a file, or <span className="register-form__link">browse</span> your computer
                </p>
              </div>
              {isHashing && (
                <p className="register-form__status" aria-live="polite">
                  Computing BLAKE3 hash…
                </p>
              )}
              {fileError && (
                <p className="register-form__error" role="alert">
                  {fileError}
                </p>
              )}
              {uploadError && (
                <p className="register-form__error" role="alert">
                  {uploadError}
                </p>
              )}
              {(fileMeta || cachedProfile) && !fileError && (
                <section className="register-form__preview" aria-live="polite">
                  <h3>Document details</h3>
                  <dl>
                    <div>
                      <dt>File name</dt>
                      <dd>{fileMeta?.name ?? cachedProfile?.fileName}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>{fileMeta?.mime ?? cachedProfile?.mime}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(fileMeta?.sizeBytes ?? cachedProfile?.sizeBytes ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Hash (BLAKE3)</dt>
                      <dd className="register-form__hash">{fileMeta?.hash ?? cachedProfile?.hash}</dd>
                    </div>
                    {uploadResult && (
                      <div>
                        <dt>Stored path</dt>
                        <dd>{uploadResult.path}</dd>
                      </div>
                    )}
                  </dl>
                  {(cachedProfile || uploadResult) && (
                    <p className="register-form__hint">
                      Uploaded at {new Date((cachedProfile?.uploadedAt ?? new Date().toISOString())).toLocaleString()}.
                    </p>
                  )}
                  {(cachedProfile || uploadResult) && !alreadyRegistered && (
                    <button type="button" className="register-form__clear" onClick={clearCachedUpload}>
                      Remove cached document
                    </button>
                  )}
                </section>
              )}
            </fieldset>

            <fieldset className="register-form__details">
              <legend>Optional details</legend>
              <label htmlFor="profileUri">Profile URI</label>
              <input
                id="profileUri"
                name="profileUri"
                type="url"
                placeholder="https://"
                value={profileUri}
                onChange={onProfileUriChange}
                aria-describedby="profileUri-hint"
                disabled={alreadyRegistered}
              />
              <p id="profileUri-hint" className="register-form__hint">
                Provide a link to your public profile or documentation repository.
              </p>

              <label htmlFor="notes">Notes</label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                value={notes}
                onChange={onNotesChange}
                placeholder="Add any context for the HaiGo operations team (optional)"
                disabled={alreadyRegistered}
              />
            </fieldset>

            <div className="register-form__actions">
              <button type="submit" disabled={!canSubmitUpload || isUploading} className="register-form__submit">
                {isUploading ? 'Uploading…' : cachedProfile || uploadResult ? 'Refresh upload cache' : 'Upload & cache documentation'}
              </button>
              {!canSubmitUpload && !alreadyRegistered && (
                <p className="register-form__disabled-hint">
                  Connect your wallet, ensure the network matches, and upload a valid document to proceed.
                </p>
              )}
              {alreadyRegistered && (
                <p className="register-form__disabled-hint">
                  This address is already registered. Update on-chain data before uploading new documents.
                </p>
              )}
            </div>
          </form>

          {activeHash && !alreadyRegistered && (
            <section className="registration-execution" aria-live="polite">
              <h2>On-chain registration</h2>
              <p>
                We will invoke <code>{registerFunction}</code> with your document hash.
              </p>
              <div className="registration-execution__controls">
                <button
                  type="button"
                  className="registration-execution__button"
                  onClick={() => void simulateRegistration()}
                  disabled={simulationState.status === 'loading'}
                >
                  {simulationState.status === 'loading' ? 'Estimating gas…' : 'Estimate gas'}
                </button>
                {simulationState.status === 'error' && (
                  <p className="registration-execution__error" role="alert">
                    {simulationState.message}
                  </p>
                )}
              </div>
              {simulationState.status === 'success' && (
                <div className="registration-execution__metrics">
                  <dl>
                    <div>
                      <dt>Gas used</dt>
                      <dd>{simulationState.estimate.gasUsed}</dd>
                    </div>
                    <div>
                      <dt>Gas unit price (Octas)</dt>
                      <dd>{simulationState.estimate.gasUnitPrice}</dd>
                    </div>
                    <div>
                      <dt>Max gas amount</dt>
                      <dd>{simulationState.estimate.maxGasAmount}</dd>
                    </div>
                    <div>
                      <dt>Txn size (bytes)</dt>
                      <dd>{simulationState.estimate.transactionSize}</dd>
                    </div>
                    <div>
                      <dt>Estimated fee (APT)</dt>
                      <dd>{formatApt(simulationState.estimate.estimatedFee)}</dd>
                    </div>
                    <div>
                      <dt>Estimated fee (USD)</dt>
                      <dd>{aptFeeUsd ? `$${aptFeeUsd.toFixed(4)}` : '—'}</dd>
                    </div>
                  </dl>
                </div>
              )}
              {simulationState.status === 'success' && (
                <button
                  type="button"
                  className="registration-execution__button registration-execution__button--primary"
                  onClick={() => void submitRegistration()}
                  disabled={['submitting', 'pending'].includes(transactionState.stage)}
                >
                  {['submitting', 'pending'].includes(transactionState.stage)
                    ? 'Awaiting confirmation…'
                    : 'Sign & submit transaction'}
                </button>
              )}
              {transactionState.stage !== 'idle' && (
                <div className="registration-timeline">
                  <h3>Status</h3>
                  <ol>
                    <li
                      className={`registration-timeline__item${isSubmitted ? ' registration-timeline__item--active' : ''}`}
                    >
                      Submitted
                      {transactionState.hash && (
                        <span className="registration-timeline__hash">{truncateAddress(transactionState.hash)}</span>
                      )}
                    </li>
                    <li
                      className={`registration-timeline__item${isPending ? ' registration-timeline__item--active' : ''}`}
                    >
                      Pending execution
                    </li>
                    <li
                      className={`registration-timeline__item${isExecuted ? ' registration-timeline__item--active' : ''}`}
                    >
                      Executed
                    </li>
                  </ol>
                  {transactionState.explorerUrl && (
                    <a
                      className="registration-timeline__link"
                      href={transactionState.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on Aptos explorer
                    </a>
                  )}
                  {transactionState.error && (
                    <p className="registration-execution__error" role="alert">
                      {transactionState.error}
                    </p>
                  )}
                  {transactionState.stage === 'success' && accountInfo && (
                    <div className="registration-success">
                      <p>
                        Registered <strong>{accountInfo.role}</strong> identity with hash{' '}
                        <code>{accountInfo.profileHash.value}</code>.
                      </p>
                      <div className="registration-success__actions">
                        <a
                          className="registration-success__cta"
                          href={accountInfo.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse'}
                        >
                          Go to dashboard
                        </a>
                        <a className="registration-success__cta registration-success__cta--secondary" href="/orders">
                          View orders
                        </a>
                      </div>
                    </div>
                  )}
                  {transactionState.stage === 'success' && !accountInfo && showRedirectCta && (
                    <div className="registration-success">
                      <p>
                        Registration succeeded on-chain. Indexing may take a moment. You can proceed to your dashboard now
                        or refresh status.
                      </p>
                      <div className="registration-success__actions">
                        <a
                          className="registration-success__cta"
                          href={role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse'}
                        >
                          Go to dashboard
                        </a>
                        <button
                          type="button"
                          className="registration-success__cta registration-success__cta--secondary"
                          onClick={() => void refreshAccountInfo()}
                        >
                          Refresh status
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      </NetworkGuard>
      {/* Aria-live region for redirect announcements */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', left: -9999 }}>
        {redirectAnnounce ?? ''}
      </div>
    </main>
  );
}
