'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type { AccountProfile } from '@shared/dto/registry';
import { fetchSessionProfile } from '../api/session';

type SessionStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SessionProfileContextValue {
  profile: AccountProfile | null;
  status: SessionStatus;
  error: string | null;
  refresh: () => Promise<AccountProfile | null>;
  clear: () => void;
  setProfile: (profile: AccountProfile | null) => void;
}

const SessionProfileContext = createContext<SessionProfileContextValue | undefined>(undefined);

export interface SessionProfileProviderProps {
  children: ReactNode;
  initialProfile?: AccountProfile | null;
}

export function SessionProfileProvider({ children, initialProfile = null }: SessionProfileProviderProps) {
  const [profile, setProfileState] = useState<AccountProfile | null>(initialProfile ?? null);
  const [status, setStatus] = useState<SessionStatus>(initialProfile ? 'ready' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<AccountProfile | null> | null>(null);

  const setProfile = useCallback((next: AccountProfile | null) => {
    setProfileState(next);
    setStatus('ready');
    setError(null);
  }, []);

  const clear = useCallback(() => {
    setProfileState(null);
    setStatus('idle');
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const promise = (async (): Promise<AccountProfile | null> => {
      setStatus('loading');
      setError(null);
      try {
        const next = await fetchSessionProfile();
        setProfileState(next ?? null);
        setStatus('ready');
        return next ?? null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load session profile';
        setError(message);
        setStatus('error');
        throw err;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = promise;
    return promise;
  }, []);

  const value = useMemo(
    () => ({
      profile,
      status,
      error,
      refresh,
      clear,
      setProfile
    }),
    [profile, status, error, refresh, clear, setProfile]
  );

  return <SessionProfileContext.Provider value={value}>{children}</SessionProfileContext.Provider>;
}

export function useSessionProfile() {
  const context = useContext(SessionProfileContext);
  if (!context) {
    throw new Error('useSessionProfile must be used within SessionProfileProvider');
  }

  return {
    sessionProfile: context.profile,
    status: context.status,
    error: context.error,
    refresh: context.refresh,
    clearLocalSession: context.clear,
    setSessionProfile: context.setProfile
  } as const;
}
