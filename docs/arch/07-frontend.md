# Frontend

## UX Source of Truth
- 完整的交互与信息架构记录在 `docs/front-end-spec.md`，其中 Epic 1 注册体验详见该文档的“身份注册（Epic 1 Story 1.3）”章节。
- 架构层 Anchor 以本档案为准；若 UX 方案更新，需同步修改本节及 `docs/front-end-spec.md` 中的引用。

## Delivered Flow · Registration (Epic 1)
- 主界面位于 `apps/web/features/registration/RegisterView.tsx:132`，负责钱包状态、表单缓存、文档上传与交易提交。
- Core 表单提交逻辑：

```tsx
// apps/web/features/registration/RegisterView.tsx:361
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
```

- 交易签名与状态机更新：

```tsx
// apps/web/features/registration/RegisterView.tsx:562
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
      setAccountInfo({
        address: accountAddress,
        role,
        profileHash: { algo: 'blake3', value: activeHash },
        profileUri: profileUri || cachedProfile?.profileUri,
        registeredAt: new Date().toISOString(),
        orderCount: accountInfo?.orderCount
      });
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
    setTransactionState({
      stage: 'failed',
      error: error instanceof Error ? error.message : 'Wallet submission failed.'
    });
  }
}, [accountAddress, activeHash, buildRegisterTransactionInput, cachedProfile, networkStatus.expected, pollTransaction, profileUri, refreshAccountInfo, role, signAndSubmitTransaction, simulationState.status, accountInfo?.orderCount]);
```

- 相关 API 与测试 Anchor：`apps/web/lib/api/registration.ts:58`（查询）、`:90`（上传）；`apps/web/lib/crypto/blake3.ts:9`；Vitest 覆盖位于 `apps/web/lib/api/registration.test.ts:16` 与 `apps/web/features/registration/RegisterView.test.tsx:113`。

## Wallet & Network Guard Infrastructure
- 钱包上下文集中于 `apps/web/lib/wallet/context.tsx:71`，负责网络校验、连接状态与签名能力。

```tsx
// apps/web/lib/wallet/context.tsx:71
const WalletContextBridge = ({ children }: { children: ReactNode }) => {
  const { account, connect: rawConnect, disconnect: rawDisconnect, connected, isLoading, wallet, wallets, network, signAndSubmitTransaction, signTransaction } = useWallet();
  const [connectionError, setConnectionError] = useState<string>();
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(() => computeNetworkStatus(network?.name));
  const aptos = useMemo(() => new Aptos(new AptosConfig({ network: resolveNetwork() })), []);

  useEffect(() => {
    setNetworkStatus(computeNetworkStatus(network?.name));
  }, [network?.name, connected]);

  const refreshNetworkStatus = useCallback(async (retries = 0): Promise<NetworkStatus> => {
    let attempt = 0;
    let status = computeNetworkStatus(network?.name);
    while (!status.actual && attempt < retries) {
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)));
      status = computeNetworkStatus(network?.name);
    }
    setNetworkStatus(status);
    return status;
  }, [network?.name]);

  const connect = useCallback(async (walletName: string) => {
    setConnectionError(undefined);
    try {
      await rawConnect(walletName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect wallet';
      setConnectionError(message);
      throw error;
    }
  }, [rawConnect]);

  const disconnect = useCallback(async () => {
    setConnectionError(undefined);
    await rawDisconnect();
    setNetworkStatus(computeNetworkStatus(undefined));
  }, [rawDisconnect]);

  const status: WalletConnectionStatus = isLoading ? 'connecting' : connected ? 'connected' : 'disconnected';
  const availableWallets = useMemo(() => wallets.map((item) => ({ name: item.name, icon: item.icon ?? '', readyState: item.readyState })), [wallets]);

  const value: WalletContextValue = {
    status,
    accountAddress: account?.address?.toString(),
    accountPublicKey: account?.publicKey?.toString(),
    walletName: wallet?.name,
    availableWallets,
    connect,
    disconnect,
    networkStatus,
    refreshNetworkStatus,
    connectionError,
    aptos,
    signAndSubmitTransaction,
    signTransaction
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};
```

- 网络保护组件 `apps/web/lib/wallet/network-guard.tsx:16` 在加载时刷新网络状态并提供 fallback UI。
- App Router Provider 挂载位置：`apps/web/app/providers.tsx:6`。

## API & Storage Utilities
- 前端通过 `apps/web/lib/api/client.ts:15` 构建 BFF URL，JSON 解析位于 `apps/web/lib/api/client.ts:20`。
- 成功上传后的缓存写入 `sessionStorage`，参见 `apps/web/features/registration/RegisterView.tsx:103`（`saveCache` 与 `loadCache`）。
- 媒体上传客户端 `apps/web/lib/api/media.ts:38` 负责 multipart 请求与服务器哈希比对。

## Testing & Accessibility
- 端到端交互测试覆盖注册 happy path、gas 估算与错误处理：`apps/web/features/registration/RegisterView.test.tsx:113`。
- API 层单测验证请求参数与返回映射：`apps/web/lib/api/registration.test.ts:16`。
- 注册表单使用 ARIA tablist/tabpanel 结构以满足可访问性（`apps/web/features/registration/RegisterView.tsx:779`）。

## Planned Surfaces (Epic 2+)
- 订单创建与费用向导：`apps/web/features/orders/CreateOrderView.tsx (planned)`；UX 详见 `docs/front-end-spec.md#商家创建并支付订单`。
- 仓主任务与出入库流程：`apps/web/features/orders/outbound` 系列（planned），参考 UX 中的“仓主处理入库与出库”。
- 理赔与质押面板：`apps/web/features/claims/ClaimWorkflow.tsx (planned)`、`apps/web/features/staking/hooks/useStakingSummary.ts (planned)`，对应 UX 章节“理赔申请与审批”“质押控制台”。
- 所有未来实现需在提交代码前更新 `docs/arch/03-data-flows.md` 与本文件的 Anchor。

## Cross-Document Workflow
1. 需求或设计调整 → 更新 `docs/front-end-spec.md` 对应章节。
2. 引入代码或重构 → 修订本档案中的路径/行号与代码片段。
3. Story 完结前执行 Vitest 套件并验证 UX 交互符合规范。
