import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChangesHistory } from '../../../shared/contracts';
import type { ChangesApi, Load } from './useWorkspaceChanges';

export interface ChangesHistoryLoad {
  history: Load<ChangesHistory>;
  /** True while a reload runs over a history that is already shown. */
  refreshing: boolean;
  reload(): void;
}

interface Loaded {
  workspaceId: string | null;
  load: Load<ChangesHistory>;
  /** The reload request this response answered. */
  request: number;
}

const LOADING: Load<never> = { state: 'loading' };

/**
 * Loads a workspace's review history while active; responses for an older
 * workspace or request are dropped. A null workspace loads nothing.
 */
export function useChangesHistory(
  api: ChangesApi,
  workspaceId: string | null,
  active: boolean
): ChangesHistoryLoad {
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const [request, setRequest] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ workspaceId, load: LOADING, request: -1 });

  useEffect(() => {
    if (!active || workspaceId === null) return undefined;
    let current = true;
    apiRef.current.getChangesHistory(workspaceId).then(
      (value) => {
        if (current) setLoaded({ workspaceId, load: { state: 'ready', value }, request });
      },
      () => {
        if (current) setLoaded({ workspaceId, load: { state: 'error' }, request });
      }
    );
    return () => {
      current = false;
    };
  }, [active, request, workspaceId]);

  const reload = useCallback(() => setRequest((value) => value + 1), []);
  const history = loaded.workspaceId === workspaceId ? loaded.load : LOADING;

  return {
    history,
    refreshing: history.state === 'ready' && loaded.request !== request,
    reload
  };
}
