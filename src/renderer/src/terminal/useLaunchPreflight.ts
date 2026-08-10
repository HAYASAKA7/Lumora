import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';

import type {
  LaunchPrepareRequest,
  LaunchPreview,
  LumoraApi
} from '../../../shared/contracts';

export type LaunchPreflightStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'failed';

export interface LaunchPreflightResult {
  status: LaunchPreflightStatus;
  preview: LaunchPreview | null;
  isCurrentLaunchToken(launchToken: string): boolean;
  retry(): void;
}

interface StoredPreflightState {
  requestKey: string | null;
  status: LaunchPreflightStatus;
  preview: LaunchPreview | null;
}

const IDLE_STATE: StoredPreflightState = {
  requestKey: null,
  status: 'idle',
  preview: null
};

export function useLaunchPreflight(
  request: LaunchPrepareRequest | null,
  api: Pick<LumoraApi, 'prepareLaunch'> = window.lumora
): LaunchPreflightResult {
  const requestKey = request === null ? null : JSON.stringify(request);
  const generation = useRef(0);
  const currentLaunchToken = useRef<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [stored, setStored] = useState<StoredPreflightState>(IDLE_STATE);

  useEffect(() => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;

    if (request === null || requestKey === null) {
      setStored(IDLE_STATE);
      return () => {
        if (generation.current === currentGeneration) {
          generation.current += 1;
        }
      };
    }

    setStored({
      requestKey,
      status: 'preparing',
      preview: null
    });
    void api.prepareLaunch(request).then(
      (preview) => {
        if (generation.current !== currentGeneration) return;
        setStored({ requestKey, status: 'ready', preview });
      },
      () => {
        if (generation.current !== currentGeneration) return;
        setStored({ requestKey, status: 'failed', preview: null });
      }
    );

    return () => {
      if (generation.current === currentGeneration) {
        generation.current += 1;
      }
    };
  }, [api, requestKey, retryVersion]);

  const retry = useCallback(() => {
    if (requestKey === null) return;
    generation.current += 1;
    setStored({ requestKey, status: 'preparing', preview: null });
    setRetryVersion((current) => current + 1);
  }, [requestKey]);

  let status = stored.status;
  let preview = stored.preview;
  if (requestKey === null) {
    status = 'idle';
    preview = null;
  } else if (stored.requestKey !== requestKey) {
    status = 'preparing';
    preview = null;
  }

  useLayoutEffect(() => {
    currentLaunchToken.current =
      status === 'ready' ? preview?.launchToken ?? null : null;
    return () => {
      currentLaunchToken.current = null;
    };
  }, [preview?.launchToken, status]);

  const isCurrentLaunchToken = useCallback(
    (launchToken: string) => currentLaunchToken.current === launchToken,
    []
  );

  return { status, preview, isCurrentLaunchToken, retry };
}
