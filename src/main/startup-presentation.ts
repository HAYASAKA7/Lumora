import { STARTUP_BACKGROUND_ACTIVITY_FALLBACK_MS } from '../shared/startup-presentation';

export interface StartupPresentationController {
  isClaimAvailable(): boolean;
  claim(): Promise<boolean>;
  markWindowShown(): void;
}

export interface StartupBackgroundActivityController {
  start(): void;
  complete(): void;
  dispose(): void;
}

interface BackgroundActivityTarget {
  isDestroyed(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
}

export function createStartupPresentationController(): StartupPresentationController {
  let claimed = false;
  let windowShown = false;
  let releaseFirstClaim: (() => void) | null = null;

  return {
    isClaimAvailable() {
      return !claimed;
    },
    async claim() {
      if (claimed) {
        return false;
      }
      claimed = true;

      if (!windowShown) {
        await new Promise<void>((resolve) => {
          releaseFirstClaim = resolve;
        });
      }

      return true;
    },
    markWindowShown() {
      if (windowShown) {
        return;
      }
      windowShown = true;
      releaseFirstClaim?.();
      releaseFirstClaim = null;
    }
  };
}

export function createStartupBackgroundActivityController(
  target: BackgroundActivityTarget
): StartupBackgroundActivityController {
  let disposed = false;
  let started = false;
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;

  const restore = () => {
    if (disposed || !started) {
      return;
    }
    disposed = true;

    if (restoreTimer !== null) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }

    if (!target.isDestroyed()) {
      target.setBackgroundThrottling(true);
    }
  };

  return {
    start() {
      if (started || disposed) {
        return;
      }
      started = true;
      target.setBackgroundThrottling(false);
      restoreTimer = setTimeout(
        restore,
        STARTUP_BACKGROUND_ACTIVITY_FALLBACK_MS
      );
    },
    complete() {
      restore();
    },
    dispose() {
      if (!started) {
        disposed = true;
      }
      restore();
    }
  };
}
