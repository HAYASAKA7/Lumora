import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import type {
  LaunchPrepareRequest,
  LaunchPreview
} from '../../../shared/contracts';

export type LaunchPreflightStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'failed';

export interface LaunchPreflightResult {
  status: LaunchPreflightStatus;
  preview: LaunchPreview | null;
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
  request: LaunchPrepareRequest | null
): LaunchPreflightResult {
  const requestKey = request === null ? null : JSON.stringify(request);
  const generation = useRef(0);
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
    void window.lumora.prepareLaunch(request).then(
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
  }, [requestKey, retryVersion]);

  const retry = useCallback(() => {
    if (requestKey === null) return;
    generation.current += 1;
    setStored({ requestKey, status: 'preparing', preview: null });
    setRetryVersion((current) => current + 1);
  }, [requestKey]);

  if (requestKey === null) {
    return { status: 'idle', preview: null, retry };
  }
  if (stored.requestKey !== requestKey) {
    return { status: 'preparing', preview: null, retry };
  }
  return { status: stored.status, preview: stored.preview, retry };
}
