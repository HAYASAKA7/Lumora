export interface StartupPresentationController {
  claim(): Promise<boolean>;
  markWindowShown(): void;
}

export function createStartupPresentationController(): StartupPresentationController {
  let claimed = false;
  let windowShown = false;
  let releaseFirstClaim: (() => void) | null = null;

  return {
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
