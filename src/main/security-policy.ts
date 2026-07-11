import { isAbsolute, relative, resolve } from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';

interface GuardedWebContents {
  setWindowOpenHandler(handler: () => { action: 'deny' }): unknown;
  on(
    event: 'will-navigate',
    handler: (event: { preventDefault(): void }, url: string) => void
  ): unknown;
}

export function createSecureWindowOptions(
  preloadPath: string
): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  };
}

export function isTrustedRendererUrl(
  rendererUrl: string,
  developmentOrigin?: string
): boolean {
  try {
    const parsedRenderer = new URL(rendererUrl);
    const isPackagedRenderer =
      parsedRenderer.protocol === 'app:' &&
      parsedRenderer.hostname === 'lumora' &&
      parsedRenderer.port === '' &&
      parsedRenderer.username === '' &&
      parsedRenderer.password === '';

    if (isPackagedRenderer) {
      return true;
    }

    if (developmentOrigin === undefined) {
      return false;
    }

    const parsedDevelopmentOrigin = new URL(developmentOrigin);
    const isHttpDevelopmentOrigin =
      parsedDevelopmentOrigin.protocol === 'http:' ||
      parsedDevelopmentOrigin.protocol === 'https:';

    return (
      isHttpDevelopmentOrigin &&
      parsedRenderer.origin === parsedDevelopmentOrigin.origin
    );
  } catch {
    return false;
  }
}

export function installWindowGuards(
  webContents: GuardedWebContents,
  developmentOrigin?: string
): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, developmentOrigin)) {
      event.preventDefault();
    }
  });
}

export function resolveRendererAssetPath(
  rendererRoot: string,
  requestUrl: string
): string | null {
  if (!isTrustedRendererUrl(requestUrl)) {
    return null;
  }

  try {
    const pathname = decodeURIComponent(new URL(requestUrl).pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) {
      return null;
    }

    const segments = pathname.split('/');
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      return null;
    }

    const relativeAssetPath = pathname.replace(/^\/+/, '') || 'index.html';
    const resolvedRoot = resolve(rendererRoot);
    const resolvedAsset = resolve(resolvedRoot, relativeAssetPath);
    const relativeToRoot = relative(resolvedRoot, resolvedAsset);

    if (
      relativeToRoot.startsWith('..') ||
      isAbsolute(relativeToRoot)
    ) {
      return null;
    }

    return resolvedAsset;
  } catch {
    return null;
  }
}
