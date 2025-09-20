import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountProfile } from '@shared/dto/registry';
import type { SignMessageFn } from '../session/ensureSession';
import { ensureSession } from '../session/ensureSession';

export type AuthSessionStatus =
  | 'idle'
  | 'requesting_challenge'
  | 'awaiting_signature'
  | 'verifying'
  | 'verified'
  | 'error';

interface AuthSessionState {
  status: AuthSessionStatus;
  profile?: AccountProfile;
  error?: string;
  rawError?: Error;
}

interface BeginParams {
  address: string;
  signMessage?: SignMessageFn;
  fallbackPublicKey?: string;
}

const INITIAL_STATE: AuthSessionState = { status: 'idle' };

type Callbacks = Parameters<typeof ensureSession>[3];

export function useAuthSession() {
  const [state, setState] = useState<AuthSessionState>(INITIAL_STATE);
  const lastParamsRef = useRef<BeginParams | null>(null);
  const runningRef = useRef(false);
  const unmountedRef = useRef(false);

  const reset = useCallback(() => {
    lastParamsRef.current = null;
    runningRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  const normalizeError = useCallback((error: unknown): string => {
    if (!error) return 'Failed to sign in.';
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (error instanceof TypeError && normalized.includes('fetch')) {
      return 'Backend unavailable. Ensure @haigo/bff is running and retry.';
    }
    if (normalized.includes('does not support message signing')) {
      return 'Your wallet does not support message signing. Please switch to Petra or Martian.';
    }
    if (normalized.includes('login signature')) {
      return 'No signature was returned. Approve the login request in your wallet and retry.';
    }
    if (normalized.includes('user rejected') || normalized.includes('rejected the request')) {
      return 'The signature request was declined. Authorize the login in your wallet to continue.';
    }
    if (normalized.includes('unauthorized') || normalized.includes('401')) {
      return 'Session verification failed. Retry the login flow.';
    }
    if (normalized.includes('signature') && normalized.includes('invalid')) {
      return 'Invalid signature received. Retry the login request from your wallet.';
    }
    return message || 'Failed to sign in.';
  }, []);

  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    []
  );

  const run = useCallback(
    async (params: BeginParams, isRetry = false) => {
      if (runningRef.current) return;
      runningRef.current = true;
      unmountedRef.current = false;
      lastParamsRef.current = params;
      setState((prev) => ({
        ...prev,
        status: isRetry && prev.status !== 'idle' ? prev.status : 'requesting_challenge',
        error: undefined,
        rawError: undefined
      }));

      const callbacks: Callbacks = {
        onChallenge: () => {
          if (unmountedRef.current) return;
          setState((prev) => ({ ...prev, status: 'requesting_challenge' }));
        },
        onSigning: () => {
          if (unmountedRef.current) return;
          setState((prev) => ({ ...prev, status: 'awaiting_signature' }));
        },
        onVerifying: () => {
          if (unmountedRef.current) return;
          setState((prev) => ({ ...prev, status: 'verifying' }));
        }
      };

      try {
        const profile = await ensureSession(params.address, params.signMessage, params.fallbackPublicKey, callbacks);
        if (unmountedRef.current) return;
        setState({ status: 'verified', profile });
      } catch (error) {
        if (unmountedRef.current) return;
        const friendly = normalizeError(error);
        setState({ status: 'error', error: friendly, rawError: error instanceof Error ? error : new Error(String(error)) });
      } finally {
        runningRef.current = false;
      }
    },
    [normalizeError]
  );

  const begin = useCallback(
    async (params: BeginParams) => {
      await run(params, false);
    },
    [run]
  );

  const retry = useCallback(async () => {
    if (!lastParamsRef.current) return;
    await run(lastParamsRef.current, true);
  }, [run]);

  const setIdle = useCallback(() => {
    lastParamsRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const inProgress = useMemo(
    () => ['requesting_challenge', 'awaiting_signature', 'verifying'].includes(state.status),
    [state.status]
  );

  const isVerified = state.status === 'verified';
  const hasError = state.status === 'error';

  return {
    state,
    begin,
    retry,
    reset,
    setIdle,
    inProgress,
    isVerified,
    hasError,
    lastParams: lastParamsRef.current
  };
}
