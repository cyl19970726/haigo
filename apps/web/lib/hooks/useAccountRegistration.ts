'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { AccountProfile } from '@shared/dto/registry';
import { fetchAccountProfile } from '../api/registration';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type RegistrationFlowStatus =
  | 'idle'
  | 'checking'
  | 'waiting'
  | 'registered'
  | 'unregistered'
  | 'error';

export interface RegistrationState {
  status: RegistrationFlowStatus;
  attempts: number;
  profile?: AccountProfile;
  error?: string;
}

export type RegistrationResult =
  | { status: 'registered'; profile: AccountProfile }
  | { status: 'unregistered' }
  | { status: 'error'; message: string }
  | { status: 'idle' }
  | { status: 'cancelled' };

interface UseAccountRegistrationOptions {
  attempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
}

const DEFAULT_OPTIONS: Required<UseAccountRegistrationOptions> = {
  attempts: 3,
  initialDelayMs: 1000,
  backoffFactor: 2
};

/**
 * Encapsulates retry logic around fetchAccountProfile with exponential backoff.
 */
export function useAccountRegistration(options?: UseAccountRegistrationOptions) {
  const config = useMemo(() => ({ ...DEFAULT_OPTIONS, ...options }), [options]);
  const [state, setState] = useState<RegistrationState>({ status: 'idle', attempts: 0 });
  const controllerRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const cancel = useCallback(() => {
    controllerRef.current.cancelled = true;
  }, []);

  const reset = useCallback(() => {
    controllerRef.current = { cancelled: false };
    setState({ status: 'idle', attempts: 0 });
  }, []);

  const check = useCallback(
    async (address?: string): Promise<RegistrationResult> => {
      if (!address) {
        reset();
        return { status: 'idle' };
      }

      controllerRef.current.cancelled = false;
      setState({ status: 'checking', attempts: 0 });
      let attempts = 0;

      try {
        while (attempts < config.attempts) {
          attempts += 1;
          const profile = await fetchAccountProfile(address);

          if (controllerRef.current.cancelled) {
            return { status: 'cancelled' };
          }

          if (profile) {
            setState({ status: 'registered', attempts, profile });
            return { status: 'registered', profile };
          }

          if (attempts < config.attempts) {
            setState({ status: 'waiting', attempts });
            const delay = config.initialDelayMs * Math.pow(config.backoffFactor, attempts - 1);
            await wait(delay);
            if (controllerRef.current.cancelled) {
              return { status: 'cancelled' };
            }
            setState({ status: 'checking', attempts });
          }
        }

        setState({ status: 'unregistered', attempts });
        return { status: 'unregistered' };
      } catch (error) {
        if (controllerRef.current.cancelled) {
          return { status: 'cancelled' };
        }
        const message = error instanceof Error ? error.message : 'Failed to load account profile';
        setState({ status: 'error', attempts, error: message });
        return { status: 'error', message };
      }
    },
    [config.attempts, config.backoffFactor, config.initialDelayMs, reset]
  );

  return { state, check, reset, cancel, config };
}
