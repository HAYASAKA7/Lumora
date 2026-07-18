import { useCallback, useEffect, useRef } from 'react';

export const CATALOG_EXIT_REFRESH_DELAY_MS = 1_500;
export const CATALOG_AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;

export function useCatalogAutoRefresh({
  refresh
}: {
  refresh(): Promise<void>;
}): { scheduleAfterExit(): void } {
  const refreshRef = useRef(refresh);
  const inFlight = useRef<Promise<void> | null>(null);
  const exitTimer = useRef<number | null>(null);
  const staleWhileHidden = useRef(false);
  refreshRef.current = refresh;

  const run = useCallback(() => {
    if (inFlight.current !== null) {
      return inFlight.current;
    }
    const pending = refreshRef
      .current()
      .catch(() => undefined)
      .finally(() => {
        if (inFlight.current === pending) {
          inFlight.current = null;
        }
      });
    inFlight.current = pending;
    return pending;
  }, []);

  const scheduleAfterExit = useCallback(() => {
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
    }
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      void run();
    }, CATALOG_EXIT_REFRESH_DELAY_MS);
  }, [run]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.hidden) {
        staleWhileHidden.current = true;
      } else {
        void run();
      }
    }, CATALOG_AUTO_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden && staleWhileHidden.current) {
        staleWhileHidden.current = false;
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [run]);

  return { scheduleAfterExit };
}
