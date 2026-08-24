import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import type {
  LumoraApi,
  ProviderUpdateCheckResult
} from '../../../shared/contracts';

export type ProviderUpdatesStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; check: ProviderUpdateCheckResult }
  | { state: 'error' };

export interface UseProviderUpdatesOptions {
  api: Pick<LumoraApi, 'checkProviderUpdates'>;
  enabled: boolean;
  discoveryReady: boolean;
}

export interface ProviderUpdatesController {
  status: ProviderUpdatesStatus;
  refreshing: boolean;
  refresh(): Promise<void>;
}

export function useProviderUpdates({
  api,
  enabled,
  discoveryReady
}: UseProviderUpdatesOptions): ProviderUpdatesController {
  const [status, setStatus] = useState<ProviderUpdatesStatus>({
    state: 'idle'
  });
  const [refreshing, setRefreshing] = useState(false);
  const statusRef = useRef(status);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const automaticCheckApiRef = useRef<UseProviderUpdatesOptions['api'] | null>(
    null
  );
  const automaticCheckStartedRef = useRef(false);

  const commitStatus = useCallback((next: ProviderUpdatesStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!discoveryReady) return Promise.resolve();
    if (inFlightRef.current !== null) return inFlightRef.current;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (statusRef.current.state !== 'ready') {
      commitStatus({ state: 'loading' });
    }
    setRefreshing(true);

    const operation = api.checkProviderUpdates().then(
      (check) => {
        if (mountedRef.current && generationRef.current === generation) {
          commitStatus({ state: 'ready', check });
        }
      },
      () => {
        if (
          mountedRef.current &&
          generationRef.current === generation &&
          statusRef.current.state !== 'ready'
        ) {
          commitStatus({ state: 'error' });
        }
      }
    ).finally(() => {
      if (generationRef.current === generation) {
        inFlightRef.current = null;
        if (mountedRef.current) setRefreshing(false);
      }
    });
    inFlightRef.current = operation;
    return operation;
  }, [api, commitStatus, discoveryReady]);

  useEffect(() => {
    if (!enabled || !discoveryReady) {
      generationRef.current += 1;
      inFlightRef.current = null;
      automaticCheckStartedRef.current = false;
      automaticCheckApiRef.current = null;
      setRefreshing(false);
      commitStatus({ state: 'idle' });
      return;
    }

    if (automaticCheckApiRef.current !== api) {
      generationRef.current += 1;
      inFlightRef.current = null;
      automaticCheckStartedRef.current = false;
      automaticCheckApiRef.current = api;
    }
    if (automaticCheckStartedRef.current) return;

    automaticCheckStartedRef.current = true;
    void refresh();
  }, [api, commitStatus, discoveryReady, enabled, refresh]);

  return { status, refreshing, refresh };
}
