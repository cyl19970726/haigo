'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe2, Share2, ShieldCheck, Ship, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useAccountRegistration } from '../lib/hooks/useAccountRegistration';
import { ensureSession } from '../lib/session/ensureSession';
import { useWalletContext } from '../lib/wallet/context';
import { useSessionProfile } from '../lib/session/profile-context';
import { logoutSession } from '../lib/api/session';

const PRIORITY_WALLETS = ['petra', 'martian'];

type SessionPhase = 'idle' | 'preparing' | 'signing' | 'verifying' | 'ready' | 'error';

type BackendStatus = 'unknown' | 'ok' | 'unreachable';

const isNetworkError = (message?: string | null) => {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('connection refused') ||
    normalized.includes('net::err_connection_refused')
  );
};

const normalizeAddress = (value?: string | null) => (value ? value.toLowerCase() : null);

export default function LandingPage() {
  const router = useRouter();
  const {
    status,
    accountAddress,
    accountPublicKey,
    availableWallets,
    connect,
    disconnect,
    connectionError,
    signMessage
  } = useWalletContext();
  const { sessionProfile, status: sessionStatus, refresh: refreshSessionProfile, clearLocalSession, setSessionProfile } = useSessionProfile();

  const { state: registrationState, check, reset, cancel } = useAccountRegistration({
    attempts: 3,
    initialDelayMs: 1000,
    backoffFactor: 3
  });

  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('idle');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('unknown');
  const [isConnectBusy, setIsConnectBusy] = useState(false);
  const [sessionAttemptAddress, setSessionAttemptAddress] = useState<string | null>(null);

  const activeRef = useRef(true);
  const logoutSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      activeRef.current = false;
      cancel();
    };
  }, [cancel]);

  const preferredWallet = useMemo(() => {
    if (!availableWallets.length) return undefined;
    const decorated = availableWallets.map((wallet) => ({
      ...wallet,
      key: wallet.name.toLowerCase(),
      ready: (wallet.readyState ?? '').toLowerCase().includes('installed')
    }));

    for (const candidate of PRIORITY_WALLETS) {
      const match = decorated.find((wallet) => wallet.key.includes(candidate) && wallet.ready);
      if (match) return match;
    }

    const installed = decorated.filter((wallet) => wallet.ready);
    return installed[0] ?? decorated[0];
  }, [availableWallets]);

  const registerHref = useMemo(() => {
    if (!accountAddress) return '/register';
    return `/register?address=${encodeURIComponent(accountAddress)}&force=1`;
  }, [accountAddress]);

  const normalizedAccountAddress = useMemo(() => normalizeAddress(accountAddress), [accountAddress]);
  const normalizedSessionAddress = useMemo(() => normalizeAddress(sessionProfile?.address), [sessionProfile?.address]);

  const clearBrowserCaches = useCallback((address?: string | null) => {
    if (typeof window === 'undefined') return;
    try {
      if (address) {
        window.sessionStorage?.removeItem?.(`haigo:registration:${address}`);
      }
      window.localStorage?.removeItem?.('haigo:orders:create');
    } catch (error) {
      console.warn('[HaiGo] Failed to clear cached registration payloads', error);
    }
  }, []);

  useEffect(() => {
    if (!normalizedSessionAddress || !normalizedAccountAddress) {
      logoutSignatureRef.current = null;
      return;
    }

    if (normalizedSessionAddress === normalizedAccountAddress) {
      logoutSignatureRef.current = null;
      return;
    }

    const signature = `${normalizedSessionAddress}->${normalizedAccountAddress}`;
    if (logoutSignatureRef.current === signature) {
      return;
    }
    logoutSignatureRef.current = signature;

    void (async () => {
      try {
        await logoutSession();
      } catch (error) {
        console.warn('[HaiGo] Failed to logout mismatched session', error);
      } finally {
        clearLocalSession();
        clearBrowserCaches(normalizedSessionAddress);
        setSessionPhase('idle');
        setSessionError(null);
        setLookupMessage(null);
        setBackendStatus('unknown');
        setSessionAttemptAddress(null);
        reset();
        cancel();
      }
    })();
  }, [
    normalizedSessionAddress,
    normalizedAccountAddress,
    clearLocalSession,
    clearBrowserCaches,
    reset,
    cancel
  ]);

  useEffect(() => {
    if (sessionStatus === 'idle') {
      void refreshSessionProfile().catch(() => {});
    }
  }, [refreshSessionProfile, sessionStatus]);

  const attemptSession = useCallback(
    async (address: string) => {
      if (!signMessage) {
        setSessionPhase('error');
        setSessionError('当前钱包不支持消息签名。');
        return;
      }

      setSessionPhase('preparing');
      setSessionError(null);

      try {
        const profile = await ensureSession(address, signMessage, accountPublicKey, {
          onChallenge: () => {
            if (!activeRef.current) return;
            setSessionPhase('preparing');
            setSessionError(null);
          },
          onSigning: () => {
            if (!activeRef.current) return;
            setSessionPhase('signing');
            setSessionError(null);
          },
          onVerifying: () => {
            if (!activeRef.current) return;
            setSessionPhase('verifying');
            setSessionError(null);
          }
        });

        if (!activeRef.current) return;

        setSessionPhase('ready');
        setSessionError(null);

        if (profile) {
          setSessionProfile(profile);
        }

        const target = profile.role === 'seller' ? '/dashboard/seller' : '/dashboard/warehouse';
        router.push(target);
      } catch (error) {
        if (!activeRef.current) return;
        const message = error instanceof Error ? error.message : '会话建立失败。';
        setSessionPhase('error');
        setSessionError(message);
      }
    },
    [accountPublicKey, router, setSessionProfile, signMessage]
  );

  useEffect(() => {
    if (!accountAddress) {
      cancel();
      reset();
      setLookupMessage(null);
      setSessionPhase('idle');
      setSessionError(null);
      setBackendStatus('unknown');
      setSessionAttemptAddress(null);
      return;
    }

    setLookupMessage('正在检查注册状态…');
    setBackendStatus('unknown');

    let disposed = false;

    void (async () => {
      try {
        const result = await check(accountAddress);
        if (disposed || !activeRef.current) return;

        if (result.status === 'error' && isNetworkError(result.message)) {
          setBackendStatus('unreachable');
        }
      } catch (error) {
        if (disposed || !activeRef.current) return;
        const message = error instanceof Error ? error.message : '注册数据加载失败。';
        setLookupMessage(message);
        setSessionPhase('idle');
        setSessionError(null);
        if (isNetworkError(message)) {
          setBackendStatus('unreachable');
        }
      }
    })();

    return () => {
      disposed = true;
      cancel();
    };
  }, [accountAddress, cancel, check, reset]);

  useEffect(() => {
    if (!accountAddress) return;

    switch (registrationState.status) {
      case 'checking':
        setLookupMessage('正在检查注册状态…');
        break;
      case 'waiting': {
        const attempt = Math.min(registrationState.attempts + 1, 3);
        setLookupMessage(`正在等待注册信息更新（第 ${attempt} 次尝试，共 3 次）。索引器更新可能需要 60 秒。`);
        break;
      }
      case 'registered':
        if (registrationState.profile) {
          setLookupMessage('注册已确认，正在建立会话…');
          const normalized = registrationState.profile.address.toLowerCase();
          if (sessionAttemptAddress !== normalized) {
            setSessionAttemptAddress(normalized);
            void attemptSession(registrationState.profile.address);
          }
        }
        break;
      case 'unregistered':
        setLookupMessage('未找到该钱包的注册信息，请继续完成身份注册。');
        setSessionPhase('idle');
        setSessionAttemptAddress(null);
        break;
      case 'error': {
        const message = registrationState.error ?? '加载账户信息失败';
        setLookupMessage(message);
        setSessionPhase('idle');
        setSessionAttemptAddress(null);
        if (isNetworkError(message)) {
          setBackendStatus('unreachable');
        }
        break;
      }
      default:
        break;
    }
  }, [accountAddress, attemptSession, registrationState, sessionAttemptAddress]);

  const handleConnectClick = useCallback(async () => {
    if (!accountAddress) {
      if (!preferredWallet) {
        setSessionPhase('error');
        setSessionError('未检测到 Aptos 钱包，请安装 Petra 或其它兼容钱包后重试。');
        return;
      }
      setIsConnectBusy(true);
      setSessionPhase('idle');
      setSessionError(null);
      try {
        await connect(preferredWallet.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : '钱包连接失败。';
        setSessionPhase('error');
        setSessionError(message);
      } finally {
        setIsConnectBusy(false);
      }
      return;
    }

    if (registrationState.status === 'registered' && registrationState.profile) {
      await attemptSession(registrationState.profile.address);
      return;
    }

    if (accountAddress) {
      setLookupMessage('正在刷新注册状态…');
      setSessionAttemptAddress(null);
      try {
        const result = await check(accountAddress);
        if (result.status === 'error' && isNetworkError(result.message)) {
          setBackendStatus('unreachable');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '刷新注册状态失败。';
        setLookupMessage(message);
        if (isNetworkError(message)) {
          setBackendStatus('unreachable');
        }
      }
    }
  }, [accountAddress, attemptSession, check, connect, preferredWallet, registrationState]);

  const handleRetryRegistration = useCallback(async () => {
    if (!accountAddress) return;
    setLookupMessage('正在重试注册查询…');
    setSessionAttemptAddress(null);
    try {
      const result = await check(accountAddress);
      if (result.status === 'error' && isNetworkError(result.message)) {
        setBackendStatus('unreachable');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '刷新注册状态失败。';
      setLookupMessage(message);
      if (isNetworkError(message)) {
        setBackendStatus('unreachable');
      }
    }
  }, [accountAddress, check]);

  const sessionPhaseCaption = useMemo(() => {
    switch (sessionPhase) {
      case 'preparing':
        return '正在准备登录挑战…';
      case 'signing':
        return '请在钱包中确认签名请求。';
      case 'verifying':
        return '正在验证签名，请稍候…';
      case 'ready':
        return '登录成功，正在跳转…';
      default:
        return null;
    }
  }, [sessionPhase]);

  const isConnecting = status === 'connecting';
  const isConnected = status === 'connected';

  const connectDisabled =
    isConnectBusy ||
    isConnecting ||
    sessionPhase === 'signing' ||
    sessionPhase === 'verifying';

  const connectLabel = useMemo(() => {
    if (isConnectBusy || isConnecting) return '连接中…';
    if (sessionPhase === 'signing') return '等待签名…';
    if (sessionPhase === 'verifying') return '验证中…';
    if (isConnected && registrationState.status === 'registered') return '立即登录';
    if (isConnected) return '刷新状态';
    return '连接钱包登录';
  }, [isConnectBusy, isConnecting, isConnected, registrationState.status, sessionPhase]);

  const showRetryLookup = Boolean(accountAddress) && ['error', 'unregistered'].includes(registrationState.status);

  const statusPills = useMemo(() => {
    const pills: Array<{ key: string; text: string; tone?: 'error' | 'success' }> = [];

    if (!availableWallets.length) {
      pills.push({
        key: 'wallet-missing',
        text: '请安装兼容的 Aptos 钱包（如 Petra 或 Martian）以继续。'
      });
    }

    if (backendStatus === 'unreachable') {
      pills.push({
        key: 'backend-unreachable',
        text: '无法连接到后台服务 http://localhost:3001，请启动 BFF（pnpm dev:bff）后重试。',
        tone: 'error'
      });
    }

    if (
      sessionProfile?.address &&
      normalizedSessionAddress &&
      normalizedAccountAddress &&
      normalizedSessionAddress !== normalizedAccountAddress
    ) {
      pills.push({
        key: 'address-mismatch',
        text: `已登录地址 ${sessionProfile.address} 与当前钱包 ${accountAddress} 不一致。已经退出旧会话，请重新登录以继续。`,
        tone: 'error'
      });
    }

    if (connectionError) {
      pills.push({ key: 'connection-error', text: connectionError, tone: 'error' });
    }

    if (sessionPhase === 'error' && sessionError) {
      pills.push({ key: 'session-error', text: sessionError, tone: 'error' });
    }

    if (lookupMessage) {
      pills.push({
        key: 'lookup',
        text: lookupMessage,
        tone: registrationState.status === 'error' ? 'error' : undefined
      });
    }

    if (sessionPhaseCaption && sessionPhase !== 'error') {
      pills.push({
        key: 'phase',
        text: sessionPhaseCaption,
        tone: sessionPhase === 'ready' ? 'success' : undefined
      });
    }

    return pills;
  }, [
    availableWallets.length,
    backendStatus,
    accountAddress,
    connectionError,
    lookupMessage,
    registrationState.status,
    sessionProfile?.address,
    normalizedAccountAddress,
    normalizedSessionAddress,
    sessionPhase,
    sessionPhaseCaption,
    sessionError
  ]);

  const infoChips = [
    { key: 'rwa', label: 'RWA', Icon: ShieldCheck },
    { key: 'blockchain', label: '区块链', Icon: Globe2 },
    { key: 'sharing', label: '共享经济', Icon: Share2 }
  ] as const;

  return (
    <main className="home-page">
      <div className="home-shell">
          <div className="home-topline">
            <span className="home-topline__badge">
              <Sparkles size={16} strokeWidth={1.8} />
              基于Aptos的海外仓RWA平台
            </span>
          </div>

          <div className="home-brand">
            <div className="home-brand__logo">
              <Ship strokeWidth={1.6} size={40} />
            </div>
            <h1 className="home-brand__title">HaiGo</h1>
            <p className="home-brand__subtitle">让物流更自由</p>
            <p className="home-english-copy">
              Providing cross-border e-commerce sellers with reliable and accessible distributed warehouses and logistics solution.
            </p>
          </div>

          <h2 className="home-main-line">为跨境电商卖家提供可信、可用的分布式仓储物流解决方案</h2>

          <div className="home-actions">
            <Button disabled={connectDisabled || !availableWallets.length} onClick={handleConnectClick}>
              {connectLabel}
            </Button>
            <Button variant="outline" onClick={() => router.push(registerHref)} disabled={registrationState.status === 'checking'}>
              注册
            </Button>
            {isConnected && (
              <Button variant="ghost" onClick={() => void disconnect()} disabled={isConnecting}>
                断开连接
              </Button>
            )}
            {showRetryLookup && (
              <Button variant="ghost" onClick={() => void handleRetryRegistration()}>
                重试查询
              </Button>
            )}
          </div>

          {statusPills.length > 0 && (
            <div className="home-status" role="status" aria-live="polite">
              {statusPills.map(({ key, text, tone }) => (
                <span key={key} className={`home-status__pill${tone ? ` home-status__pill--${tone}` : ''}`}>
                  {text}
                </span>
              ))}
            </div>
          )}

          <div className="home-chips">
            {infoChips.map(({ key, label, Icon }) => (
              <span key={key} className="home-chip">
                <Icon size={18} strokeWidth={1.8} />
                {label}
              </span>
            ))}
          </div>

          <footer className="home-footer" aria-label="Footer">
            © 2025 HaiGo · Web3 Logistics Network
          </footer>
      </div>
    </main>
  );
}
