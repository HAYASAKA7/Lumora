import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createSecureWindowOptions,
  installWindowGuards,
  isTrustedRendererUrl,
  resolveRendererAssetPath
} from './security-policy';

describe('createSecureWindowOptions', () => {
  it('returns a sandboxed, isolated renderer with no Node.js integration', () => {
    const preloadPath = resolve('out/preload/index.js');

    const options = createSecureWindowOptions(preloadPath);

    expect(options.webPreferences).toMatchObject({
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    });
  });

  it('uses a supplied taskbar icon without requiring one on other platforms', () => {
    const preloadPath = resolve('out/preload/index.js');
    const iconPath = resolve('resources/icons/lumora/windows/LumoraTransparent.ico');

    expect(createSecureWindowOptions(preloadPath, iconPath).icon).toBe(iconPath);
    expect(createSecureWindowOptions(preloadPath)).not.toHaveProperty('icon');
  });
});

describe('isTrustedRendererUrl', () => {
  it('accepts the packaged application and exact configured development origin', () => {
    expect(isTrustedRendererUrl('app://lumora/index.html')).toBe(true);
    expect(
      isTrustedRendererUrl(
        'http://localhost:5173/src/main.tsx',
        'http://localhost:5173'
      )
    ).toBe(true);
  });

  it('rejects remote, lookalike, and unconfigured development URLs', () => {
    expect(isTrustedRendererUrl('https://example.com')).toBe(false);
    expect(isTrustedRendererUrl('app://lumora.example/index.html')).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5173/index.html')).toBe(false);
    expect(
      isTrustedRendererUrl(
        'http://localhost:4173/index.html',
        'http://localhost:5173'
      )
    ).toBe(false);
  });
});

describe('installWindowGuards', () => {
  it('denies child windows and prevents navigation outside the trusted renderer', () => {
    let windowOpenHandler:
      | ((details: { url: string }) => { action: 'deny' })
      | undefined;
    let navigationHandler:
      | ((event: { preventDefault(): void }, url: string) => void)
      | undefined;

    const webContents = {
      setWindowOpenHandler(
        handler: (details: { url: string }) => { action: 'deny' }
      ) {
        windowOpenHandler = handler;
      },
      on(
        event: string,
        handler: (event: { preventDefault(): void }, url: string) => void
      ) {
        if (event === 'will-navigate') {
          navigationHandler = handler;
        }
      }
    };

    installWindowGuards(webContents, 'http://localhost:5173');

    expect(windowOpenHandler?.({ url: 'https://example.com' })).toEqual({
      action: 'deny'
    });

    let externalNavigationPrevented = false;
    navigationHandler?.(
      {
        preventDefault() {
          externalNavigationPrevented = true;
        }
      },
      'https://example.com'
    );
    expect(externalNavigationPrevented).toBe(true);

    let trustedNavigationPrevented = false;
    navigationHandler?.(
      {
        preventDefault() {
          trustedNavigationPrevented = true;
        }
      },
      'app://lumora/settings'
    );
    expect(trustedNavigationPrevented).toBe(false);
  });
});

describe('resolveRendererAssetPath', () => {
  it('resolves packaged application assets beneath the renderer root', () => {
    const rendererRoot = resolve('out/renderer');

    expect(
      resolveRendererAssetPath(
        rendererRoot,
        'app://lumora/assets/application.js'
      )
    ).toBe(join(rendererRoot, 'assets', 'application.js'));
  });

  it('rejects other origins, encoded traversal, and encoded separators', () => {
    const rendererRoot = resolve('out/renderer');

    expect(
      resolveRendererAssetPath(rendererRoot, 'app://other/index.html')
    ).toBeNull();
    expect(
      resolveRendererAssetPath(
        rendererRoot,
        'app://lumora/%2e%2e%2fsecrets.txt'
      )
    ).toBeNull();
    expect(
      resolveRendererAssetPath(
        rendererRoot,
        'app://lumora/assets%5csecrets.txt'
      )
    ).toBeNull();
  });
});
