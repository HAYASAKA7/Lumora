import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  type LumoraApi,
  type LumoraWindowContext
} from '../../shared/contracts';
import { WindowRoot } from './WindowRoot';
import { TEST_LOCALIZATION_SNAPSHOT } from './test/render-with-localization';

const TARGET_ID = '0e3f3da6-b340-49f6-b03b-8ae032c3af74';
const localizationApi = {
  getLocalizationSnapshot: vi.fn().mockResolvedValue(TEST_LOCALIZATION_SNAPSHOT),
  onLocalizationChanged: vi.fn(() => vi.fn())
};

describe('WindowRoot', () => {
  it('owns the app focus policy before resolving the window mode', () => {
    const api = {
      ...localizationApi,
      getWindowContext: vi.fn().mockReturnValue(
        new Promise<LumoraWindowContext>(() => undefined)
      )
    } as unknown as LumoraApi;
    render(
      <>
        <WindowRoot api={api} />
        <button type="button">Unbound action</button>
      </>
    );
    const button = screen.getByRole('button', { name: 'Unbound action' });
    button.focus();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
      code: 'Tab'
    });

    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(button).not.toHaveFocus();
  });

  it('mounts the isolated remote shell without starting local application scans', async () => {
    const api = {
      ...localizationApi,
      getWindowContext: vi.fn().mockResolvedValue({
        mode: 'remote', executionTargetId: TARGET_ID
      }),
      getAppearancePresentation: vi.fn().mockResolvedValue({
        appearance: DEFAULT_GENERAL_SETTINGS.appearance,
        background: { available: false, revision: null }
      }),
      listRemoteTargets: vi.fn().mockResolvedValue([]),
      getSystemInfo: vi.fn(),
      scanProviders: vi.fn(),
      getCatalog: vi.fn()
    } as unknown as LumoraApi;

    render(<WindowRoot api={api} />);

    expect(await screen.findByText('This remote target is unavailable.'))
      .toBeInTheDocument();
    expect(api.getSystemInfo).not.toHaveBeenCalled();
    expect(api.scanProviders).not.toHaveBeenCalled();
    expect(api.getCatalog).not.toHaveBeenCalled();
  });

  it('applies the global appearance and managed background to the remote shell', async () => {
    const api = {
      ...localizationApi,
      getWindowContext: vi.fn().mockResolvedValue({
        mode: 'remote', executionTargetId: TARGET_ID
      }),
      getAppearancePresentation: vi.fn().mockResolvedValue({
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          theme: 'dark',
          backgroundEnabled: true,
          surfaceMosaic: 9,
          interfaceFontFamily: 'Atkinson Hyperlegible',
          terminalFontFamily: 'JetBrains Mono'
        },
        background: { available: true, revision: '1720000000000-4096' }
      }),
      listRemoteTargets: vi.fn().mockResolvedValue([])
    } as unknown as LumoraApi;

    render(<WindowRoot api={api} />);

    const shell = await screen.findByTestId('remote-appearance-root');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    expect(shell).toHaveClass('has-appearance-background', 'has-surface-mosaic');
    expect(shell.getAttribute('style')).toContain('--appearance-surface-mosaic: 9px');
    expect(shell.getAttribute('style')).toContain(
      '--font-ui: "Atkinson Hyperlegible", Inter'
    );
    expect(shell.getAttribute('style')).toContain(
      '--font-mono: "JetBrains Mono", "Cascadia Mono"'
    );
    expect(shell.querySelector('.appearance-background-layer')).toHaveStyle({
      backgroundImage:
        'url("app://appearance/background?revision=1720000000000-4096")'
    });
  });

  it('passes the global presentation into the connected shared shell', async () => {
    const api = {
      ...localizationApi,
      getWindowContext: vi.fn().mockResolvedValue({
        mode: 'remote', executionTargetId: TARGET_ID
      }),
      getAppearancePresentation: vi.fn().mockResolvedValue({
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          theme: 'dark',
          backgroundEnabled: true,
          surfaceMosaic: 7
        },
        background: { available: true, revision: '1720000000000-4096' }
      }),
      listRemoteTargets: vi.fn().mockResolvedValue([{
        target: {
          id: TARGET_ID,
          kind: 'remote',
          displayName: 'Linux build server',
          platform: 'linux',
          architecture: 'x64',
          connectionState: 'ready',
          helperVersion: '0.3.0',
          protocolVersion: 1,
          capabilities: ['provider-scan', 'session-scan'],
          lastConnectedAt: '2026-08-05T04:03:02.000Z',
          lastScannedAt: null
        },
        profile: {
          executionTargetId: TARGET_ID,
          displayName: 'Linux build server',
          route: 'direct',
          host: 'linux.internal',
          port: 22,
          username: 'builder',
          sshConfigHost: null,
          authentication: { method: 'password' },
          verifiedHostFingerprint: 'SHA256:test',
          createdAt: '2026-08-04T09:00:00.000Z',
          updatedAt: '2026-08-04T09:00:00.000Z'
        }
      }]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['opencode']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        environment: {
          checkedAt: '2026-08-05T04:03:02.000Z',
          node: { state: 'not_found', executablePath: null, version: null },
          npm: { state: 'not_found', executablePath: null, version: null }
        },
        providers: { scannedAt: '2026-08-05T04:03:02.000Z', providers: [] }
      }),
      scanRemoteSessions: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        sessions: [],
        providers: [],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [], sessions: [], providerStatus: [],
          providerFacets: [], diagnostics: []
        }
      })
    } as unknown as LumoraApi;

    render(<WindowRoot api={api} />);

    const shell = await screen.findByTestId('lumora-shell');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    expect(shell).toHaveClass('has-appearance-background', 'has-surface-mosaic');
    expect(shell.getAttribute('style')).toContain('--appearance-surface-mosaic: 7px');
  });

  it('refreshes global appearance when a remote window regains focus', async () => {
    const getAppearancePresentation = vi.fn()
      .mockResolvedValueOnce({
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          theme: 'dark'
        },
        background: { available: false, revision: null }
      })
      .mockResolvedValueOnce({
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          theme: 'light'
        },
        background: { available: false, revision: null }
      });
    const api = {
      ...localizationApi,
      getWindowContext: vi.fn().mockResolvedValue({
        mode: 'remote', executionTargetId: TARGET_ID
      }),
      getAppearancePresentation,
      listRemoteTargets: vi.fn().mockResolvedValue([])
    } as unknown as LumoraApi;

    render(<WindowRoot api={api} />);
    expect(await screen.findByTestId('remote-appearance-root'))
      .toHaveAttribute('data-theme', 'dark');

    await act(async () => {
      fireEvent.focus(window);
    });

    expect(screen.getByTestId('remote-appearance-root'))
      .toHaveAttribute('data-theme', 'light');
    expect(getAppearancePresentation).toHaveBeenCalledTimes(2);
  });
});
