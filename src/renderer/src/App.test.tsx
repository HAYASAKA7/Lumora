import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useEffect, useRef } from 'react';

import lumoraBrandMarkUrl from '../../../resources/icons/lumora/source/lumora-symbol-gradient.svg';
import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS
} from '../../shared/contracts';
import type {
  CatalogQuery,
  CatalogSnapshot,
  DeveloperEnvironmentScanResult,
  LaunchPreview,
  ProviderScanResult,
  RuntimeEvent,
  RuntimeSummary,
  SystemInfo,
  TerminalProfile
} from '../../shared/contracts';
import App from './App';
import { CATALOG_EXIT_REFRESH_DELAY_MS } from './catalog/useCatalogAutoRefresh';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    parser = { registerOscHandler: vi.fn() };
    loadAddon(): void {}
    open(): void {}
    focus(): void {}
    write(): void {}
    dispose(): void {}
    onData(): { dispose(): void } {
      return { dispose(): void {} };
    }
    onResize(): { dispose(): void } {
      return { dispose(): void {} };
    }
  }
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  }
}));

vi.mock('./terminal/ManagedTerminal', () => ({
  ManagedTerminal: ({
    active,
    focusRequestKey,
    platform,
    runtime,
    onRuntimeChange
  }: {
    active: boolean;
    focusRequestKey?: number;
    platform: SystemInfo['platform'];
    runtime: RuntimeSummary;
    onRuntimeChange(runtime: RuntimeSummary): void;
  }) => {
    const inputRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
      let active = true;
      void window.lumora.attachRuntime(runtime.id).then(
        (attachment) => {
          if (active) onRuntimeChange(attachment.runtime);
        },
        () => undefined
      );
      return () => {
        active = false;
      };
    }, [onRuntimeChange, runtime.id]);
    useEffect(() => {
      if (active) inputRef.current?.focus();
    }, [active, focusRequestKey]);
    return (
      <div className="managed-terminal-shell" data-platform={platform}>
        <button
          aria-label={`${runtime.displayName} terminal input`}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.code === 'KeyV') {
              void window.lumora.readClipboardText();
            }
          }}
          ref={inputRef}
          type="button"
        />
        <div
          aria-label={`${runtime.provider} terminal`}
          className="managed-terminal"
        />
      </div>
    );
  }
}));

const readyProviderScan: ProviderScanResult = {
  scannedAt: '2026-07-11T01:02:03.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: 'C:\\tools\\codex.exe',
      version: 'codex-cli 1.2.3',
      issue: null
    },
    {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'ready',
      executablePath: 'C:\\tools\\claude.exe',
      version: '2.3.4 (Claude Code)',
      issue: null
    }
  ]
};

const degradedProviderScan: ProviderScanResult = {
  scannedAt: '2026-07-11T01:03:00.000Z',
  providers: [
    readyProviderScan.providers[0]!,
    {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'Claude Code was not found on PATH.',
        recovery: 'Install Claude Code or add it to PATH, then refresh.',
        retryable: true
      }
    }
  ]
};

const readyEnvironmentScan: DeveloperEnvironmentScanResult = {
  checkedAt: '2026-07-17T01:02:03.000Z',
  node: {
    state: 'ready',
    executablePath: 'C:\\tools\\node.exe',
    version: 'v24.18.0'
  },
  npm: {
    state: 'ready',
    executablePath: 'C:\\tools\\npm.cmd',
    version: '11.6.2'
  }
};

const missingNodeEnvironmentScan: DeveloperEnvironmentScanResult = {
  checkedAt: '2026-07-17T01:03:00.000Z',
  node: { state: 'not_found', executablePath: null, version: null },
  npm: { state: 'not_found', executablePath: null, version: null }
};

const readyCatalog: CatalogSnapshot = {
  refreshedAt: '2026-07-11T04:00:00.000Z',
  workspaces: [
    {
      id: 'a'.repeat(64),
      displayName: 'Lumora',
      canonicalPath: 'D:\\Projects\\AI\\Lumora',
      available: true,
      origin: 'manual',
      sessionCount: 1,
      providerCounts: { codex: 1, claude: 0 },
      lastActivityAt: '2026-07-11T03:45:00.000Z'
    }
  ],
  sessions: [
    {
      id: 'b'.repeat(64),
      nativeId: 'codex-1',
      provider: 'codex',
      workspaceId: 'a'.repeat(64),
      title: 'Catalog implementation',
      createdAt: '2026-07-11T03:00:00.000Z',
      updatedAt: '2026-07-11T03:45:00.000Z',
      lifetimeTokens: null,
      lifecycle: 'saved',
      sourceFreshness: 'current'
    }
  ],
  providerStatus: [
    {
      provider: 'codex',
      state: 'ready',
      discoveredCount: 1,
      unchangedCount: 0,
      invalidCount: 0
    },
    {
      provider: 'claude',
      state: 'ready',
      discoveredCount: 0,
      unchangedCount: 0,
      invalidCount: 0
    }
  ],
  providerFacets: [
    { provider: 'codex', sessionCount: 1 },
    { provider: 'claude', sessionCount: 1 }
  ],
  diagnostics: []
};

function runningRuntime(
  id: string,
  provider: RuntimeSummary['provider'] = 'codex'
): RuntimeSummary {
  return {
    id,
    displayName: provider === 'codex' ? 'Codex working session' : 'Claude working session',
    strategy: 'new',
    sessionId: null,
    nativeSessionId: null,
    reconciliationState: 'pending',
    provider,
    workspaceId: readyCatalog.workspaces[0]!.id,
    terminalProfileId: 'c'.repeat(64),
    launchHash: 'd'.repeat(64),
    state: 'running',
    pid: 4321,
    createdAt: '2026-07-13T01:00:00.000Z',
    startedAt: '2026-07-13T01:00:01.000Z',
    endedAt: null,
    exitCode: null,
    errorCode: null
  };
}

interface CatalogApiOverrides {
  claimStartupPresentation?: ReturnType<typeof vi.fn>;
  scanDeveloperEnvironment?: ReturnType<typeof vi.fn>;
  openNodeDownloadPage?: ReturnType<typeof vi.fn>;
  getCatalog?: ReturnType<typeof vi.fn>;
  refreshCatalog?: ReturnType<typeof vi.fn>;
  chooseWorkspace?: ReturnType<typeof vi.fn>;
  getTerminalProfiles?: ReturnType<typeof vi.fn>;
  getGeneralSettings?: ReturnType<typeof vi.fn>;
  saveGeneralSettings?: ReturnType<typeof vi.fn>;
  getKeyboardSettings?: ReturnType<typeof vi.fn>;
  readClipboardText?: ReturnType<typeof vi.fn>;
  writeClipboardText?: ReturnType<typeof vi.fn>;
  prepareLaunch?: ReturnType<typeof vi.fn>;
  startRuntime?: ReturnType<typeof vi.fn>;
  attachRuntime?: ReturnType<typeof vi.fn>;
  listRuntimes?: ReturnType<typeof vi.fn>;
  onRuntimeEvent?: (
    listener: (event: RuntimeEvent) => void
  ) => () => void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setSystemInfoResult(
  result: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    platform: 'win32',
    arch: 'x64',
    appVersion: '0.1.0'
  }),
  scanProviders: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue(readyProviderScan),
  catalogApi: CatalogApiOverrides = {}
): void {
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: {
      claimStartupPresentation:
        catalogApi.claimStartupPresentation ?? vi.fn().mockResolvedValue(false),
      getSystemInfo: result,
      scanProviders,
      scanDeveloperEnvironment:
        catalogApi.scanDeveloperEnvironment ??
        vi.fn().mockResolvedValue(readyEnvironmentScan),
      openNodeDownloadPage:
        catalogApi.openNodeDownloadPage ??
        vi.fn().mockResolvedValue(undefined),
      getCatalog: catalogApi.getCatalog ?? vi.fn().mockResolvedValue(readyCatalog),
      refreshCatalog:
        catalogApi.refreshCatalog ?? vi.fn().mockResolvedValue(readyCatalog),
      chooseWorkspace:
        catalogApi.chooseWorkspace ?? vi.fn().mockResolvedValue(null),
      readClipboardText:
        catalogApi.readClipboardText ?? vi.fn().mockResolvedValue(''),
      writeClipboardText:
        catalogApi.writeClipboardText ?? vi.fn().mockResolvedValue(undefined),
      getTerminalProfiles:
        catalogApi.getTerminalProfiles ?? vi.fn().mockResolvedValue([]),
      saveTerminalProfile: vi.fn().mockResolvedValue([]),
      deleteTerminalProfile: vi.fn().mockResolvedValue([]),
      getProviderLaunchConfigs: vi.fn().mockResolvedValue([
        { provider: 'codex', command: null },
        { provider: 'claude', command: null }
      ]),
      saveProviderLaunchConfig: vi.fn().mockResolvedValue([
        { provider: 'codex', command: null },
        { provider: 'claude', command: null }
      ]),
      getLaunchSettingsLayers: vi.fn().mockResolvedValue([]),
      saveLaunchSettingsLayer: vi.fn().mockResolvedValue([]),
      getKeyboardSettings:
        catalogApi.getKeyboardSettings ??
        vi.fn().mockResolvedValue(DEFAULT_KEYBOARD_SETTINGS),
      saveKeyboardSettings: vi.fn(async (value) => value),
      getGeneralSettings:
        catalogApi.getGeneralSettings ??
        vi.fn().mockResolvedValue(DEFAULT_GENERAL_SETTINGS),
      saveGeneralSettings:
        catalogApi.saveGeneralSettings ?? vi.fn(async (value) => value),
      getWorkspaceTrustDecisions: vi.fn().mockResolvedValue([]),
      trustWorkspaceForLaunch: vi.fn(),
      revokeWorkspaceTrust: vi.fn().mockResolvedValue([]),
      prepareLaunch: catalogApi.prepareLaunch ?? vi.fn(),
      startRuntime: catalogApi.startRuntime ?? vi.fn(),
      listRuntimes: catalogApi.listRuntimes ?? vi.fn().mockResolvedValue([]),
      attachRuntime: catalogApi.attachRuntime ?? vi.fn(),
      writeRuntime: vi.fn().mockResolvedValue(undefined),
      resizeRuntime: vi.fn().mockResolvedValue(undefined),
      terminateRuntime: vi.fn(),
      onRuntimeEvent:
        catalogApi.onRuntimeEvent ?? vi.fn(() => () => undefined)
    }
  });
}

describe('App', () => {
  beforeEach(() => setSystemInfoResult());

  it('uses the canonical Lumora brand artwork in the sidebar', () => {
    render(<App />);

    const brand = screen.getByRole('button', { name: 'Collapse sidebar' });
    const mark = brand.querySelector<HTMLImageElement>('img.brand-mark');

    expect(brand).toHaveClass('brand');
    expect(brand).toHaveAttribute('aria-expanded', 'true');
    expect(brand.querySelector('strong')).toHaveTextContent('Lumora');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('alt', '');
    expect(mark).toHaveAttribute('src', lumoraBrandMarkUrl);
  });

  it('does not show a static discovery badge in the sidebar', () => {
    render(<App />);

    expect(screen.queryByText('Discovery mode')).not.toBeInTheDocument();
    expect(document.querySelector('.sidebar-note')).not.toBeInTheDocument();
  });

  it('collapses and expands the sidebar without remounting navigation icons', async () => {
    render(<App />);

    const shell = document.querySelector('.app-shell');
    const home = screen.getByRole('button', { name: 'Home' });
    const homeIcon = home.querySelector('.icon');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(shell).toHaveClass('sidebar-collapsed');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(expand).toHaveAttribute(
        'title',
        'Expand sidebar (Ctrl + Shift + L)'
      );
      expect(home).toHaveAttribute('title', 'Home (Ctrl + 1)');
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
        'title',
        'Settings (Ctrl + 5)'
      );
    });
    expect(home.querySelector('.icon')).toBe(homeIcon);
    expect(document.querySelector('.nav-label-divider')).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    fireEvent.click(expand);

    expect(shell).not.toHaveClass('sidebar-collapsed');
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' })
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' })
    ).not.toHaveAttribute('title');
    expect(home).not.toHaveAttribute('title');
    expect(home.querySelector('.icon')).toBe(homeIcon);
  });

  it('uses customized platform-aware shortcuts in collapsed sidebar titles', async () => {
    const getKeyboardSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_KEYBOARD_SETTINGS,
      toggleSidebar: {
        code: 'KeyB',
        control: false,
        alt: true,
        shift: false,
        meta: true
      },
      openHome: {
        code: 'KeyH',
        control: false,
        alt: false,
        shift: true,
        meta: true
      }
    });
    setSystemInfoResult(
      vi.fn().mockResolvedValue({
        platform: 'darwin',
        arch: 'arm64',
        appVersion: '0.1.0'
      }),
      undefined,
      { getKeyboardSettings }
    );
    render(<App />);

    await waitFor(() => expect(getKeyboardSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Expand sidebar' })
      ).toHaveAttribute('title', 'Expand sidebar (⌥ + ⌘ + B)');
      expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
        'title',
        'Home (⇧ + ⌘ + H)'
      );
    });
  });

  it('expands while navigating from a collapsed sidebar', () => {
    render(<App />);

    const shell = document.querySelector('.app-shell');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(shell).not.toHaveClass('sidebar-collapsed');
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' })
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens on Home and exposes the complete primary navigation', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    for (const destination of [
      'Home',
      'Workspaces',
      'All sessions',
      'Terminal profiles',
      'Settings'
    ]) {
      expect(screen.getByRole('button', { name: destination })).toBeInTheDocument();
    }
  });

  it('resets the shared page scroll position when navigation changes', async () => {
    render(<App />);
    const main = document.getElementById('main-content');
    expect(main).not.toBeNull();
    if (main === null) throw new Error('main content missing');
    main.scrollTop = 480;

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));

    await waitFor(() => expect(main.scrollTop).toBe(0));
  });

  it('keeps a dismissed session warning hidden across route navigation', async () => {
    const catalogWithWarning = {
      ...readyCatalog,
      diagnostics: [
        {
          code: 'CATALOG_SOURCE_INVALID',
          provider: 'claude',
          affectedCount: 1,
          message: 'One Claude warning.',
          recovery: 'Refresh after Claude finishes writing.',
          retryable: true,
          scannedAt: '2026-07-17T04:00:00.000Z'
        }
      ]
    } satisfies CatalogSnapshot;
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockResolvedValue(catalogWithWarning),
      refreshCatalog: vi.fn().mockResolvedValue(catalogWithWarning)
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Dismiss warning: One Claude warning.'
      })
    );
    expect(screen.queryByText('One Claude warning.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));

    expect(
      screen.getByRole('heading', { name: 'All sessions' })
    ).toBeInTheDocument();
    expect(screen.queryByText('One Claude warning.')).not.toBeInTheDocument();
  });

  it('immediately closes visible session notices when the information switch is turned off', async () => {
    const catalogWithWarning = {
      ...readyCatalog,
      diagnostics: [
        {
          code: 'CATALOG_SOURCE_INVALID',
          provider: 'claude',
          affectedCount: 1,
          message: 'One live Claude warning.',
          recovery: 'Refresh after Claude finishes writing.',
          retryable: true,
          scannedAt: '2026-07-17T04:00:00.000Z'
        }
      ]
    } satisfies CatalogSnapshot;
    const saveGeneralSettings = vi.fn(async (value) => value);
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockResolvedValue(catalogWithWarning),
      refreshCatalog: vi.fn().mockResolvedValue(catalogWithWarning),
      saveGeneralSettings
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(
      await screen.findByText('One live Claude warning.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'General' }));
    fireEvent.click(
      screen.getByRole('switch', { name: 'Show informational notices' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(screen.queryByText('One live Claude warning.')).toBeNull();
    await waitFor(() =>
      expect(saveGeneralSettings).toHaveBeenCalledWith({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      })
    );
  });

  it('keeps optional session notices hidden when the saved preference is off', async () => {
    const catalogWithWarning = {
      ...readyCatalog,
      diagnostics: [
        {
          code: 'CATALOG_SOURCE_INVALID',
          provider: 'claude',
          affectedCount: 1,
          message: 'A saved-preference warning.',
          recovery: 'Refresh after Claude finishes writing.',
          retryable: true,
          scannedAt: '2026-07-17T04:00:00.000Z'
        }
      ]
    } satisfies CatalogSnapshot;
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockResolvedValue(catalogWithWarning),
      refreshCatalog: vi.fn().mockResolvedValue(catalogWithWarning),
      getGeneralSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      })
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    await screen.findByText('Catalog implementation');
    expect(screen.queryByText('A saved-preference warning.')).toBeNull();
  });

  it('restores the switch and shows an actionable error when saving fails', async () => {
    const saveGeneralSettings = vi
      .fn()
      .mockRejectedValue(new Error('storage unavailable'));
    setSystemInfoResult(undefined, undefined, { saveGeneralSettings });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'General' }));
    const informationSwitch = screen.getByRole('switch', {
      name: 'Show informational notices'
    });
    await waitFor(() => expect(informationSwitch).toBeChecked());

    fireEvent.click(informationSwitch);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Lumora could not save the informational notice setting.'
    );
    expect(informationSwitch).toBeChecked();
  });

  it('opens the General category every time Settings is entered', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const securityTab = await screen.findByRole('tab', { name: 'Security' });
    fireEvent.click(securityTab);
    expect(securityTab).toHaveAttribute('aria-selected', 'true');
    expect(
      await screen.findByRole('heading', { name: 'Workspace trust' })
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(
      screen.getByRole('heading', { name: 'General' })
    ).toBeVisible();
  });

  it('keeps a collapsed sidebar collapsed while navigating when auto-expand is disabled', async () => {
    const getGeneralSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_GENERAL_SETTINGS,
      autoExpandSidebar: false
    });
    setSystemInfoResult(undefined, undefined, { getGeneralSettings });
    render(<App />);

    await waitFor(() => expect(getGeneralSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveClass('sidebar-collapsed');
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('resets Settings scroll when its category changes', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const main = document.getElementById('main-content');
    expect(main).not.toBeNull();
    if (main === null) throw new Error('main content missing');
    main.scrollTop = 480;

    fireEvent.click(await screen.findByRole('tab', { name: 'Launch' }));

    await waitFor(() => expect(main.scrollTop).toBe(0));
  });

  it('closes the active terminal tab when its runtime completes', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ac0'
    );
    let emitRuntime!: (event: RuntimeEvent) => void;
    const onRuntimeEvent = vi.fn(
      (listener: (event: RuntimeEvent) => void) => {
        emitRuntime ??= listener;
        return () => undefined;
      }
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      }),
      onRuntimeEvent
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    expect(
      await screen.findByRole('heading', { name: 'Codex working session' })
    ).toBeInTheDocument();

    act(() => {
      emitRuntime({
        type: 'state',
        runtimeId: runtime.id,
        runtime: {
          ...runtime,
          state: 'completed',
          endedAt: '2026-07-13T01:30:00.000Z',
          exitCode: 0
        }
      });
    });

    expect(
      screen.queryByRole('heading', { name: 'Codex working session' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('quietly refreshes the current catalog after a runtime exits', async () => {
    vi.useFakeTimers();
    try {
      const runtime = runningRuntime(
        '0198f8b6-18f3-7ca0-9f0f-123456789ad0'
      );
      let emitRuntime!: (event: RuntimeEvent) => void;
      const onRuntimeEvent = vi.fn(
        (listener: (event: RuntimeEvent) => void) => {
          emitRuntime ??= listener;
          return () => undefined;
        }
      );
      const getCatalog = vi.fn().mockResolvedValue(readyCatalog);
      const refreshCatalog = vi.fn().mockResolvedValue(readyCatalog);
      setSystemInfoResult(undefined, undefined, {
        getCatalog,
        refreshCatalog,
        attachRuntime: vi.fn().mockResolvedValue({
          runtime,
          snapshot: '',
          outputSequence: 0
        }),
        listRuntimes: vi.fn().mockResolvedValue([runtime]),
        onRuntimeEvent
      });
      render(<App />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(refreshCatalog).toHaveBeenCalled();
      refreshCatalog.mockClear();
      getCatalog.mockClear();

      act(() => {
        emitRuntime({
          type: 'state',
          runtimeId: runtime.id,
          runtime: {
            ...runtime,
            state: 'completed',
            endedAt: '2026-07-18T01:30:00.000Z',
            exitCode: 0
          }
        });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CATALOG_EXIT_REFRESH_DELAY_MS - 1);
      });
      expect(refreshCatalog).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(refreshCatalog).toHaveBeenCalledOnce();
      expect(refreshCatalog).toHaveBeenCalledWith({ text: '', provider: null });
      expect(getCatalog).not.toHaveBeenCalled();
      expect(
        screen.queryByText('Catalog refresh failed. Last saved data is still shown.')
      ).not.toBeInTheDocument();

      refreshCatalog.mockRejectedValueOnce(new Error('background scan failed'));
      act(() => {
        emitRuntime({
          type: 'state',
          runtimeId: runtime.id,
          runtime: {
            ...runtime,
            state: 'failed',
            endedAt: '2026-07-18T01:31:00.000Z',
            exitCode: 1
          }
        });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CATALOG_EXIT_REFRESH_DELAY_MS);
      });
      expect(refreshCatalog).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText('Catalog refresh failed. Last saved data is still shown.')
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('activates the next terminal after the active runtime fails', async () => {
    const codexRuntime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ac1'
    );
    const claudeRuntime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ac2',
      'claude'
    );
    let emitRuntime!: (event: RuntimeEvent) => void;
    const onRuntimeEvent = vi.fn(
      (listener: (event: RuntimeEvent) => void) => {
        emitRuntime ??= listener;
        return () => undefined;
      }
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([codexRuntime, claudeRuntime]),
      attachRuntime: vi.fn().mockImplementation((runtimeId: string) => {
        const runtime =
          runtimeId === codexRuntime.id ? codexRuntime : claudeRuntime;
        return Promise.resolve({ runtime, snapshot: '', outputSequence: 0 });
      }),
      onRuntimeEvent
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    expect(
      await screen.findByRole('heading', { name: 'Codex working session' })
    ).toBeInTheDocument();

    act(() => {
      emitRuntime({
        type: 'state',
        runtimeId: codexRuntime.id,
        runtime: {
          ...codexRuntime,
          state: 'failed',
          endedAt: '2026-07-13T01:30:00.000Z',
          exitCode: 1,
          errorCode: 'PTY_RUNTIME_FAILED'
        }
      });
    });

    expect(
      screen.queryByRole('heading', { name: 'Codex working session' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Claude working session' })
    ).toBeInTheDocument();
  });

  it('keeps a terminal tab open for running state updates', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ac3'
    );
    let emitRuntime!: (event: RuntimeEvent) => void;
    const onRuntimeEvent = vi.fn(
      (listener: (event: RuntimeEvent) => void) => {
        emitRuntime ??= listener;
        return () => undefined;
      }
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      }),
      onRuntimeEvent
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    await screen.findByRole('heading', { name: 'Codex working session' });

    act(() => {
      emitRuntime({
        type: 'state',
        runtimeId: runtime.id,
        runtime
      });
    });

    expect(
      screen.getByRole('heading', { name: 'Codex working session' })
    ).toBeInTheDocument();
  });

  it('updates terminal session metadata from a synchronized runtime event', async () => {
    const runtime = {
      ...runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789ac5'),
      displayName: 'New Codex session',
      strategy: 'new' as const,
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'unresolved' as const
    };
    const listeners: Array<(event: RuntimeEvent) => void> = [];
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      }),
      onRuntimeEvent: vi.fn((listener: (event: RuntimeEvent) => void) => {
        listeners.push(listener);
        return () => undefined;
      })
    });
    render(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });
    await screen.findByRole('button', {
      name: 'New Codex session terminal input'
    });
    fireEvent.click(screen.getByRole('button', { name: 'Terminal details' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Terminal details' }))
        .getByText('Not found — unlinked')
    ).toBeInTheDocument();

    const session = readyCatalog.sessions[0]!;
    const synchronized: RuntimeSummary = {
      ...runtime,
      displayName: 'Renamed provider session',
      sessionId: session.id,
      nativeSessionId: session.nativeId,
      reconciliationState: 'linked'
    };
    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'state',
          runtimeId: runtime.id,
          runtime: synchronized
        });
      }
    });

    expect(
      screen.getByRole('tab', { name: /Renamed provider session/ })
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { name: 'Renamed provider session' })
    ).toBeInTheDocument();
    const details = screen.getByRole('dialog', { name: 'Terminal details' });
    expect(within(details).getByText('Linked')).toBeInTheDocument();
    expect(within(details).getByText(session.id.slice(0, 12)))
      .toBeInTheDocument();
  });

  it('keeps the same terminal mounted while navigating pages', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ac4'
    );
    const attachRuntime = vi.fn().mockResolvedValue({
      runtime,
      snapshot: '',
      outputSequence: 0
    });
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    const terminal = await screen.findByLabelText('codex terminal');
    await waitFor(() => expect(attachRuntime).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(screen.getByRole('heading', { name: 'All sessions' })).toBeInTheDocument();
    expect(document.body.contains(terminal)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Open terminals' }));
    expect(await screen.findByLabelText('codex terminal')).toBe(terminal);
    expect(attachRuntime).toHaveBeenCalledTimes(1);
  });

  it('cycles open terminals in MRU order and commits on modifier release', async () => {
    const first = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad0'
    );
    const second = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad1',
      'claude'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([first, second]),
      attachRuntime: vi.fn(async (runtimeId: string) => ({
        runtime: runtimeId === first.id ? first : second,
        snapshot: '',
        outputSequence: 0
      }))
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    expect(
      await screen.findByRole('tab', { name: /Codex working session/ })
    ).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });
    expect(
      screen.getByRole('option', { name: /Claude working session/ })
    ).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, {
      code: 'Tab',
      key: 'Tab',
      ctrlKey: true,
      repeat: true
    });
    expect(
      screen.getByRole('option', { name: /Claude working session/ })
    ).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyUp(window, { code: 'KeyX', key: 'x' });
    expect(screen.getByRole('dialog', { name: 'Open terminals' }))
      .toBeInTheDocument();

    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });
    expect(
      screen.getByRole('option', { name: /Codex working session/ })
    ).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });
    fireEvent.keyUp(window, { code: 'ControlLeft', key: 'Control' });

    expect(
      screen.queryByRole('dialog', { name: 'Open terminals' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /Claude working session/ })
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('moves a pending switch selection forward when that runtime exits', async () => {
    const first = {
      ...runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789ae0'),
      displayName: 'First session'
    };
    const second = {
      ...runningRuntime(
        '0198f8b6-18f3-7ca0-9f0f-123456789ae1',
        'claude'
      ),
      displayName: 'Second session'
    };
    const third = {
      ...runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789ae2'),
      displayName: 'Third session'
    };
    let emitRuntime!: (event: RuntimeEvent) => void;
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([first, second, third]),
      attachRuntime: vi.fn(async (runtimeId: string) => ({
        runtime: [first, second, third].find((item) => item.id === runtimeId)!,
        snapshot: '',
        outputSequence: 0
      })),
      onRuntimeEvent: vi.fn((listener: (event: RuntimeEvent) => void) => {
        emitRuntime = listener;
        return () => undefined;
      })
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });
    expect(screen.getByRole('option', { name: /Second session/ }))
      .toHaveAttribute('aria-selected', 'true');

    act(() => {
      emitRuntime({
        type: 'state',
        runtimeId: second.id,
        runtime: {
          ...second,
          state: 'completed',
          endedAt: '2026-07-14T02:00:00.000Z',
          exitCode: 0
        }
      });
    });

    expect(screen.getByRole('option', { name: /Third session/ }))
      .toHaveAttribute('aria-selected', 'true');
    fireEvent.keyUp(window, { code: 'ControlLeft', key: 'Control' });
    expect(screen.getByRole('tab', { name: /Third session/ }))
      .toHaveAttribute('aria-selected', 'true');
  });

  it('uses a saved switcher binding and lets Escape cancel selection', async () => {
    const first = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad2'
    );
    const second = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad3',
      'claude'
    );
    const getKeyboardSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_KEYBOARD_SETTINGS,
      terminalSwitcher: {
        code: 'KeyK',
        control: true,
        alt: false,
        shift: false,
        meta: false
      }
    });
    setSystemInfoResult(undefined, undefined, {
      getKeyboardSettings,
      listRuntimes: vi.fn().mockResolvedValue([first, second]),
      attachRuntime: vi.fn(async (runtimeId: string) => ({
        runtime: runtimeId === first.id ? first : second,
        snapshot: '',
        outputSequence: 0
      }))
    });
    render(<App />);

    await waitFor(() => expect(getKeyboardSettings).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Open terminals' }))
      .not.toBeInTheDocument();

    fireEvent.keyDown(window, { code: 'KeyK', key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Open terminals' }))
      .toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Open terminals' }))
      .not.toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /Codex working session/ })
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('navigates primary pages with the default application shortcuts', async () => {
    render(<App />);

    fireEvent.keyDown(window, { code: 'Digit2', key: '2', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Digit3', key: '3', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'All sessions' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Digit4', key: '4', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Terminal profiles' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Digit5', key: '5', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Digit1', key: '1', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Comma', key: ',', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens and refocuses a live terminal with Ctrl+T', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad8'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      })
    });
    render(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });
    const terminalInput = await screen.findByRole('button', {
      name: 'Codex working session terminal input'
    });
    expect(screen.getByRole('tab', { name: /Codex working session/ }))
      .toHaveAttribute('aria-selected', 'true');
    expect(terminalInput).toHaveFocus();

    screen.getByRole('button', { name: 'Collapse sidebar' }).focus();
    expect(terminalInput).not.toHaveFocus();
    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });
    expect(terminalInput).toHaveFocus();
  });

  it('clears the current primary navigation state while a terminal is active', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ade'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      })
    });
    render(<App />);

    const openTerminals = await screen.findByRole('button', {
      name: 'Open terminals'
    });
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    fireEvent.click(openTerminals);

    await screen.findByRole('button', {
      name: 'Codex working session terminal input'
    });
    for (const destination of [
      'Home',
      'Workspaces',
      'All sessions',
      'Terminal profiles',
      'Settings'
    ]) {
      expect(screen.getByRole('button', { name: destination }))
        .not.toHaveAttribute('aria-current');
    }
  });

  it('keeps the selected terminal when Ctrl+T is pressed on the terminal page', async () => {
    const first = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ada'
    );
    const second = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789adb',
      'claude'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([first, second]),
      attachRuntime: vi.fn(async (runtimeId: string) => ({
        runtime: runtimeId === first.id ? first : second,
        snapshot: '',
        outputSequence: 0
      }))
    });
    render(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });
    fireEvent.click(
      await screen.findByRole('tab', { name: /Claude working session/ })
    );
    const secondInput = screen.getByRole('button', {
      name: 'Claude working session terminal input'
    });
    screen.getByRole('button', { name: 'Collapse sidebar' }).focus();

    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });

    expect(screen.getByRole('tab', { name: /Claude working session/ }))
      .toHaveAttribute('aria-selected', 'true');
    expect(secondInput).toHaveFocus();
  });

  it('restores the previously selected terminal with Ctrl+T after navigating away', async () => {
    const first = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789adc'
    );
    const second = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789add',
      'claude'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([first, second]),
      attachRuntime: vi.fn(async (runtimeId: string) => ({
        runtime: runtimeId === first.id ? first : second,
        snapshot: '',
        outputSequence: 0
      }))
    });
    render(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });
    fireEvent.click(
      await screen.findByRole('tab', { name: /Claude working session/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(screen.getByRole('heading', { name: 'All sessions' }))
      .toBeInTheDocument();

    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });

    expect(screen.getByRole('tab', { name: /Claude working session/ }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', {
      name: 'Claude working session terminal input'
    })).toHaveFocus();
  });

  it('uses current runtime state when a previously registered Ctrl+T listener fires', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad9'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      })
    });
    const addEventListener = vi.spyOn(window, 'addEventListener');

    try {
      render(<App />);
      const initialKeydownListener = addEventListener.mock.calls.find(
        ([type]) => type === 'keydown'
      )?.[1];
      if (initialKeydownListener === undefined) {
        throw new Error('App keydown listener was not registered');
      }

      await screen.findByRole('button', { name: 'Open terminals' });
      act(() => {
        const event = new KeyboardEvent('keydown', {
          code: 'KeyT',
          key: 't',
          ctrlKey: true
        });
        if (typeof initialKeydownListener === 'function') {
          initialKeydownListener.call(window, event);
        } else {
          initialKeydownListener.handleEvent(event);
        }
      });

      expect(
        screen.getByRole('button', {
          name: 'Codex working session terminal input'
        })
      ).toBeInTheDocument();
    } finally {
      addEventListener.mockRestore();
    }
  });

  it('toggles the sidebar with Ctrl+Shift+L outside a terminal', () => {
    render(<App />);

    fireEvent.keyDown(window, { code: 'KeyL', key: 'l', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Collapse sidebar' }))
      .toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(window, {
      code: 'KeyL',
      key: 'L',
      ctrlKey: true,
      shiftKey: true
    });
    expect(screen.getByRole('button', { name: 'Expand sidebar' }))
      .toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(window, {
      code: 'KeyL',
      key: 'L',
      ctrlKey: true,
      shiftKey: true
    });
    expect(screen.getByRole('button', { name: 'Collapse sidebar' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles the sidebar while terminal input is focused', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ae0'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      })
    });
    render(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, { code: 'KeyT', key: 't', ctrlKey: true });
    const terminalInput = await screen.findByRole('button', {
      name: 'Codex working session terminal input'
    });
    expect(terminalInput).toHaveFocus();

    fireEvent.keyDown(terminalInput, {
      code: 'KeyL',
      key: 'L',
      ctrlKey: true,
      shiftKey: true
    });
    expect(screen.getByRole('button', { name: 'Expand sidebar' }))
      .toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(terminalInput, {
      code: 'KeyL',
      key: 'L',
      ctrlKey: true,
      shiftKey: true
    });
    expect(screen.getByRole('button', { name: 'Collapse sidebar' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('uses customized navigation shortcuts instead of their defaults', async () => {
    const getKeyboardSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_KEYBOARD_SETTINGS,
      openHome: {
        code: 'KeyH',
        control: true,
        alt: false,
        shift: true,
        meta: false
      }
    });
    setSystemInfoResult(undefined, undefined, { getKeyboardSettings });
    render(<App />);

    await waitFor(() => expect(getKeyboardSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    fireEvent.keyDown(window, { code: 'Digit1', key: '1', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
    fireEvent.keyDown(window, {
      code: 'KeyH',
      key: 'h',
      ctrlKey: true,
      shiftKey: true
    });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('gives the terminal switcher priority over a conflicting paste shortcut', async () => {
    const first = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad6'
    );
    const second = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad7',
      'claude'
    );
    const readClipboardText = vi.fn().mockResolvedValue('from clipboard');
    const getKeyboardSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_KEYBOARD_SETTINGS,
      terminalSwitcher: {
        code: 'KeyV',
        control: true,
        alt: false,
        shift: false,
        meta: false
      }
    });
    setSystemInfoResult(undefined, undefined, {
      getKeyboardSettings,
      readClipboardText,
      listRuntimes: vi.fn().mockResolvedValue([first, second]),
      attachRuntime: vi.fn(async (runtimeId: string) => ({
        runtime: runtimeId === first.id ? first : second,
        snapshot: '',
        outputSequence: 0
      }))
    });
    render(<App />);

    await waitFor(() => expect(getKeyboardSettings).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    const terminalInput = await screen.findByRole('button', {
      name: 'Codex working session terminal input'
    });
    terminalInput.focus();

    fireEvent.keyDown(terminalInput, {
      code: 'KeyV',
      key: 'v',
      ctrlKey: true
    });

    expect(screen.getByRole('dialog', { name: 'Open terminals' }))
      .toBeInTheDocument();
    expect(readClipboardText).not.toHaveBeenCalled();
  });

  it('lets the Settings recorder capture the active switcher shortcut', async () => {
    const first = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad4'
    );
    const second = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad5',
      'claude'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([first, second]),
      attachRuntime: vi.fn(async (runtimeId: string) => ({
        runtime: runtimeId === first.id ? first : second,
        snapshot: '',
        outputSequence: 0
      }))
    });
    render(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Keyboard' }));
    const recorder = await screen.findByRole('button', {
      name: 'Record terminal switcher shortcut'
    });
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, {
      code: 'Tab',
      key: 'Tab',
      ctrlKey: true
    });

    expect(recorder).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('dialog', { name: 'Open terminals' }))
      .not.toBeInTheDocument();
  });

  it('changes destination and exposes layered launch settings', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Launch' }));
    expect(
      await screen.findByRole('heading', { name: 'Launch defaults' })
    ).toBeInTheDocument();
  });

  it('opens the shared resume dialog from Home recent sessions', async () => {
    const profile: TerminalProfile = {
      id: 'c'.repeat(64),
      kind: 'detected',
      name: 'PowerShell 7',
      shellFamily: 'pwsh',
      executablePath: 'C:\\tools\\pwsh.exe',
      args: [],
      available: true,
      recommended: true
    };
    setSystemInfoResult(undefined, undefined, {
      getTerminalProfiles: vi.fn().mockResolvedValue([profile]),
      prepareLaunch: vi.fn(() => new Promise<LaunchPreview>(() => undefined))
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    const dialog = await screen.findByRole('dialog', { name: 'Resume session' });
    expect(within(dialog).getByText('Catalog implementation')).toBeInTheDocument();
    expect(within(dialog).getByText('Codex')).toBeInTheDocument();
    expect(within(dialog).getByText('Lumora')).toBeInTheDocument();
  });

  it('opens and completes a native resume from the session catalog', async () => {
    const profile: TerminalProfile = {
      id: 'c'.repeat(64),
      kind: 'detected',
      name: 'PowerShell 7',
      shellFamily: 'pwsh',
      executablePath: 'C:\\tools\\pwsh.exe',
      args: [],
      available: true,
      recommended: true
    };
    const session = readyCatalog.sessions[0]!;
    const preview: LaunchPreview = {
      launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      launchHash: 'd'.repeat(64),
      strategy: 'resume',
      sessionId: session.id,
      provider: 'codex',
      executablePath: 'C:\\tools\\codex.exe',
      args: ['resume', session.nativeId],
      command: null,
      workingDirectory: readyCatalog.workspaces[0]!.canonicalPath,
      workspaceTrusted: true,
      environmentNames: ['PATH', 'SHELL'],
      terminalProfile: profile,
      configuration: [
        {
          field: 'providerCommand',
          value: null,
          winningSource: { scope: 'default', targetId: null },
          shadowed: [],
          mergeStrategy: 'replace',
          warnings: [],
          sensitive: false
        },
        {
          field: 'terminalProfile',
          value: profile.id,
          winningSource: { scope: 'default', targetId: null },
          shadowed: [],
          mergeStrategy: 'replace',
          warnings: [],
          sensitive: false
        }
      ],
      warnings: [],
      createdAt: '2026-07-11T04:00:00.000Z',
      expiresAt: '2026-07-11T04:05:00.000Z'
    };
    const runtime: RuntimeSummary = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
      displayName: session.title,
      strategy: 'resume',
      sessionId: session.id,
      nativeSessionId: session.nativeId,
      reconciliationState: 'not_required',
      provider: 'codex',
      workspaceId: session.workspaceId,
      terminalProfileId: profile.id,
      launchHash: preview.launchHash,
      state: 'running',
      pid: 4321,
      createdAt: preview.createdAt,
      startedAt: preview.createdAt,
      endedAt: null,
      exitCode: null,
      errorCode: null
    };
    const prepareLaunch = vi.fn().mockResolvedValue(preview);
    const startRuntime = vi.fn().mockResolvedValue(runtime);
    setSystemInfoResult(undefined, undefined, {
      getTerminalProfiles: vi.fn().mockResolvedValue([profile]),
      prepareLaunch,
      startRuntime,
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      })
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Resume Catalog implementation'
      })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Resume session' });
    expect(within(dialog).getByText('Catalog implementation')).toBeInTheDocument();
    expect(within(dialog).getByText('Codex')).toBeInTheDocument();
    expect(within(dialog).getByText('Lumora')).toBeInTheDocument();

    expect(await within(dialog).findByText('resume codex-1')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume session' }));

    expect(await screen.findByRole('heading', { name: session.title })).toBeInTheDocument();
    expect(document.getElementById('main-content')).toHaveClass(
      'terminal-main-content'
    );
    expect(
      screen.queryByRole('heading', { name: 'All sessions' })
    ).not.toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'resume',
      sessionId: session.id,
      terminalProfileId: null,
      cols: 100,
      rows: 30
    });
    expect(startRuntime).toHaveBeenCalledWith(preview.launchToken);
  });

  it('recovers a lost runtime into a separate active terminal', async () => {
    const profile: TerminalProfile = {
      id: 'c'.repeat(64),
      kind: 'detected',
      name: 'PowerShell 7',
      shellFamily: 'pwsh',
      executablePath: 'C:\\tools\\pwsh.exe',
      args: [],
      available: true,
      recommended: true
    };
    const session = readyCatalog.sessions[0]!;
    const lostRuntime: RuntimeSummary = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789ab0',
      displayName: session.title,
      strategy: 'resume',
      sessionId: session.id,
      nativeSessionId: session.nativeId,
      reconciliationState: 'not_required',
      provider: 'codex',
      workspaceId: session.workspaceId,
      terminalProfileId: profile.id,
      launchHash: 'd'.repeat(64),
      state: 'runtime_lost',
      pid: null,
      createdAt: '2026-07-12T03:00:00.000Z',
      startedAt: '2026-07-12T03:00:01.000Z',
      endedAt: '2026-07-12T04:00:00.000Z',
      exitCode: null,
      errorCode: 'PTY_RUNTIME_LOST'
    };
    const preview: LaunchPreview = {
      launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789ab1',
      launchHash: 'e'.repeat(64),
      strategy: 'resume',
      sessionId: session.id,
      provider: 'codex',
      executablePath: 'C:\\tools\\codex.exe',
      args: ['resume', session.nativeId],
      command: 'codexp',
      workingDirectory: readyCatalog.workspaces[0]!.canonicalPath,
      workspaceTrusted: true,
      environmentNames: ['PATH'],
      terminalProfile: profile,
      configuration: [
        {
          field: 'providerCommand',
          value: 'codexp',
          winningSource: { scope: 'provider', targetId: 'codex' },
          shadowed: [],
          mergeStrategy: 'replace',
          warnings: [],
          sensitive: false
        },
        {
          field: 'terminalProfile',
          value: profile.id,
          winningSource: { scope: 'session', targetId: session.id },
          shadowed: [],
          mergeStrategy: 'replace',
          warnings: [],
          sensitive: false
        }
      ],
      warnings: [],
      createdAt: '2026-07-12T04:01:00.000Z',
      expiresAt: '2026-07-12T04:06:00.000Z'
    };
    const recoveredRuntime: RuntimeSummary = {
      ...lostRuntime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789ab2',
      state: 'running',
      pid: 4321,
      launchHash: preview.launchHash,
      createdAt: preview.createdAt,
      startedAt: preview.createdAt,
      endedAt: null,
      errorCode: null
    };
    const prepareLaunch = vi.fn().mockResolvedValue(preview);
    const startRuntime = vi.fn().mockResolvedValue(recoveredRuntime);
    setSystemInfoResult(undefined, undefined, {
      getTerminalProfiles: vi.fn().mockResolvedValue([profile]),
      listRuntimes: vi.fn().mockResolvedValue([lostRuntime]),
      prepareLaunch,
      startRuntime,
      attachRuntime: vi.fn().mockResolvedValue({
        runtime: recoveredRuntime,
        snapshot: '',
        outputSequence: 0
      })
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Recover' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Recover lost runtime'
    });
    expect(within(dialog).getByText(/cannot reattach/i)).toBeInTheDocument();
    expect(await within(dialog).findByText('codexp')).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Resume saved session' })
    );

    expect(
      await screen.findByRole('heading', { name: session.title })
    ).toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'resume',
      sessionId: session.id,
      terminalProfileId: null,
      cols: 100,
      rows: 30
    });
    expect(startRuntime).toHaveBeenCalledWith(preview.launchToken);

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(await screen.findByText(/1 lost runtime/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recover' })).toBeInTheDocument();
  });

  it('shows New session in the top command bar only on Home and Workspaces', async () => {
    render(<App />);

    const sessionActions = screen.getByRole('group', { name: 'Session actions' });
    expect(
      await within(sessionActions).findByRole('button', { name: 'New session' })
    ).toBeInTheDocument();
    expect(document.querySelector('.page-primary-action')).not.toBeInTheDocument();

    for (const destination of ['All sessions', 'Terminal profiles', 'Settings']) {
      fireEvent.click(screen.getByRole('button', { name: destination }));
      expect(
        within(sessionActions).queryByRole('button', { name: 'New session' })
      ).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    expect(
      within(sessionActions).getByRole('button', { name: 'New session' })
    ).toBeInTheDocument();
  });

  it('captures workspace detail for New session and resets the Home default', async () => {
    const profile: TerminalProfile = {
      id: 'c'.repeat(64),
      kind: 'detected',
      name: 'PowerShell 7',
      shellFamily: 'pwsh',
      executablePath: 'C:\\tools\\pwsh.exe',
      args: [],
      available: true,
      recommended: true
    };
    const otherWorkspace = {
      ...readyCatalog.workspaces[0]!,
      id: 'e'.repeat(64),
      displayName: 'Lumora Plugins',
      canonicalPath: 'D:\\Projects\\AI\\Lumora Plugins',
      sessionCount: 0,
      providerCounts: {}
    };
    const catalog = {
      ...readyCatalog,
      workspaces: [...readyCatalog.workspaces, otherWorkspace]
    } satisfies CatalogSnapshot;
    const prepareLaunch = vi.fn(
      () => new Promise<LaunchPreview>(() => undefined)
    );
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockResolvedValue(catalog),
      refreshCatalog: vi.fn().mockResolvedValue(catalog),
      getTerminalProfiles: vi.fn().mockResolvedValue([profile]),
      prepareLaunch
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open sessions for Lumora Plugins at D:\\Projects\\AI\\Lumora Plugins'
      })
    );
    expect(
      await screen.findByRole('heading', { name: 'Lumora Plugins sessions' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));

    const dialog = await screen.findByRole('dialog', { name: 'New session' });
    expect(
      within(dialog).getByRole('combobox', { name: 'Workspace' })
    ).toHaveValue(otherWorkspace.id);
    await waitFor(() =>
      expect(prepareLaunch).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: otherWorkspace.id })
      )
    );

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close new session' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));

    const homeDialog = await screen.findByRole('dialog', {
      name: 'New session'
    });
    expect(
      within(homeDialog).getByRole('combobox', { name: 'Workspace' })
    ).toHaveValue(readyCatalog.workspaces[0]!.id);
  });

  it('shows platform and architecture after system information resolves', async () => {
    render(<App />);

    expect(screen.getByText('Reading local system')).toBeInTheDocument();
    expect(await screen.findByText('Windows · x64')).toBeInTheDocument();
    expect(screen.getByText('Lumora 0.1.0')).toBeInTheDocument();
  });

  it('shows a non-blocking diagnostic when system information fails', async () => {
    setSystemInfoResult(vi.fn().mockRejectedValue(new Error('IPC unavailable')));
    render(<App />);

    expect(
      await screen.findByText('System details unavailable')
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('explains each Home dashboard area without fabricated data', async () => {
    render(<App />);

    for (const cardTitle of [
      'Running agents',
      'Needs attention',
      'Recent sessions',
      'Scan health'
    ]) {
      expect(
        await screen.findByRole('heading', { name: cardTitle })
      ).toBeInTheDocument();
    }
  });

  it('shows the real ready-provider count on Home', async () => {
    render(<App />);

    expect(await screen.findByText('2 of 2 providers ready')).toBeInTheDocument();
  });

  it('checks developer prerequisites at startup without warning when ready', async () => {
    const scanDeveloperEnvironment = vi
      .fn()
      .mockResolvedValue(readyEnvironmentScan);
    setSystemInfoResult(undefined, undefined, { scanDeveloperEnvironment });

    render(<App />);

    await waitFor(() => expect(scanDeveloperEnvironment).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('Node.js and npm were not found.')
    ).not.toBeInTheDocument();
  });

  it('warns about missing prerequisites without blocking the application', async () => {
    setSystemInfoResult(undefined, undefined, {
      scanDeveloperEnvironment: vi.fn().mockResolvedValue(missingNodeEnvironmentScan)
    });

    render(<App />);

    expect(
      await screen.findByText('Node.js and npm were not found.')
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('opens the official Node.js download page from the warning', async () => {
    const openNodeDownloadPage = vi.fn().mockResolvedValue(undefined);
    setSystemInfoResult(undefined, undefined, {
      scanDeveloperEnvironment: vi.fn().mockResolvedValue(missingNodeEnvironmentScan),
      openNodeDownloadPage
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Download Node.js' })
    );

    await waitFor(() => expect(openNodeDownloadPage).toHaveBeenCalledTimes(1));
  });

  it('lists detected providers, versions, and paths in Settings', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Providers' }));

    expect(
      screen.getByRole('heading', { name: 'Provider installations' })
    ).toBeInTheDocument();
    expect(await screen.findByText('codex-cli 1.2.3')).toBeInTheDocument();
    expect(screen.getByText('2.3.4 (Claude Code)')).toBeInTheDocument();
    expect(screen.getByText('C:\\tools\\codex.exe')).toBeInTheDocument();
    expect(screen.getByText('C:\\tools\\claude.exe')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Developer tools' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    expect(
      screen.getByRole('heading', { name: 'Developer tools' })
    ).toBeInTheDocument();
    expect(screen.getByText('v24.18.0')).toBeInTheDocument();
    expect(screen.getByText('11.6.2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(
      await screen.findByRole('heading', { name: 'Workspace trust' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Keyboard' }));
    expect(
      await screen.findByRole('heading', { name: 'Keyboard shortcuts' })
    ).toBeInTheDocument();
  });

  it('shows an actionable provider diagnostic without hiding healthy providers', async () => {
    setSystemInfoResult(undefined, vi.fn().mockResolvedValue(degradedProviderScan));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(await screen.findByText('codex-cli 1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(
      screen.getByText('Claude Code was not found on PATH.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Install Claude Code or add it to PATH, then refresh.')
    ).toBeInTheDocument();
  });

  it('keeps navigation usable when the provider scan fails', async () => {
    setSystemInfoResult(
      undefined,
      vi.fn().mockRejectedValue(new Error('provider IPC unavailable'))
    );
    render(<App />);

    expect(
      await screen.findByText('Provider details are unavailable')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Providers' }));
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('refreshes provider results without reloading the application', async () => {
    const scanProviders = vi
      .fn()
      .mockResolvedValueOnce(degradedProviderScan)
      .mockResolvedValueOnce(readyProviderScan);
    const scanDeveloperEnvironment = vi
      .fn()
      .mockResolvedValue(readyEnvironmentScan);
    setSystemInfoResult(undefined, scanProviders, { scanDeveloperEnvironment });
    render(<App />);

    expect(await screen.findByText('1 of 2 providers ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('2.3.4 (Claude Code)')).toBeInTheDocument();
    expect(scanProviders).toHaveBeenCalledTimes(2);
    expect(scanDeveloperEnvironment).toHaveBeenCalledTimes(1);
  });

  it('saves provider scope and immediately rescans providers and sessions', async () => {
    const codexOnlyScan: ProviderScanResult = {
      ...readyProviderScan,
      providers: readyProviderScan.providers.filter(
        ({ provider }) => provider === 'codex'
      )
    };
    const scanProviders = vi
      .fn()
      .mockResolvedValueOnce(readyProviderScan)
      .mockResolvedValueOnce(codexOnlyScan);
    const saveGeneralSettings = vi.fn(async (value) => value);
    const refreshCatalog = vi.fn().mockResolvedValue({
      ...readyCatalog,
      providerStatus: readyCatalog.providerStatus.filter(
        ({ provider }) => provider === 'codex'
      ),
      providerFacets: readyCatalog.providerFacets.filter(
        ({ provider }) => provider === 'codex'
      ),
      sessions: readyCatalog.sessions.filter(
        ({ provider }) => provider === 'codex'
      )
    });
    setSystemInfoResult(undefined, scanProviders, {
      getGeneralSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_GENERAL_SETTINGS,
        enabledProviders: ['codex', 'claude']
      }),
      refreshCatalog,
      saveGeneralSettings
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Providers' }));
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Use Claude Code' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Save provider selection' })
    );

    await waitFor(() =>
      expect(saveGeneralSettings).toHaveBeenCalledWith({
        ...DEFAULT_GENERAL_SETTINGS,
        enabledProviders: ['codex']
      })
    );
    await waitFor(() => expect(scanProviders).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refreshCatalog).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Claude Code' })
      ).not.toBeInTheDocument()
    );
  });

  it('refreshes developer prerequisites independently', async () => {
    const scanDeveloperEnvironment = vi
      .fn()
      .mockResolvedValueOnce(missingNodeEnvironmentScan)
      .mockResolvedValueOnce(readyEnvironmentScan);
    const scanProviders = vi.fn().mockResolvedValue(readyProviderScan);
    setSystemInfoResult(undefined, scanProviders, { scanDeveloperEnvironment });
    render(<App />);

    expect(
      await screen.findByText('Node.js and npm were not found.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh environment' })
    );

    expect(await screen.findByText('v24.18.0')).toBeInTheDocument();
    expect(scanDeveloperEnvironment).toHaveBeenCalledTimes(2);
    expect(scanProviders).toHaveBeenCalledTimes(1);
  });

  it('ignores stale prerequisite results after a newer refresh', async () => {
    const firstScan = deferred<DeveloperEnvironmentScanResult>();
    const scanDeveloperEnvironment = vi
      .fn()
      .mockReturnValueOnce(firstScan.promise)
      .mockResolvedValueOnce(readyEnvironmentScan);
    setSystemInfoResult(undefined, undefined, { scanDeveloperEnvironment });
    render(<App />);

    await waitFor(() => expect(scanDeveloperEnvironment).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh environment' })
    );
    expect(await screen.findByText('v24.18.0')).toBeInTheDocument();

    await act(async () => firstScan.resolve(missingNodeEnvironmentScan));
    expect(
      screen.queryByText('Node.js and npm were not found.')
    ).not.toBeInTheDocument();
  });

  it('renders persisted catalog data before background refresh completes', async () => {
    const refreshCatalog = vi.fn(() => new Promise<CatalogSnapshot>(() => {}));
    const getCatalog = vi.fn().mockResolvedValue(readyCatalog);
    setSystemInfoResult(undefined, undefined, { getCatalog, refreshCatalog });

    render(<App />);

    expect(await screen.findByText('1 workspace')).toBeInTheDocument();
    expect(screen.getByText('Catalog implementation')).toBeInTheDocument();
    expect(getCatalog).toHaveBeenCalledWith({ text: '', provider: null });
    expect(refreshCatalog).toHaveBeenCalledWith({ text: '', provider: null });
  });

  it('uses the native workspace picker and preserves data when it is cancelled', async () => {
    const chooseWorkspace = vi.fn().mockResolvedValue(null);
    setSystemInfoResult(undefined, undefined, { chooseWorkspace });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    expect(
      await screen.findByRole('heading', { name: 'Lumora' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add workspace' }));

    await waitFor(() => expect(chooseWorkspace).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: 'Lumora' })).toBeInTheDocument();
  });

  it('loads complete workspace history and resumes from the workspace detail', async () => {
    const profile: TerminalProfile = {
      id: 'c'.repeat(64),
      kind: 'detected',
      name: 'PowerShell 7',
      shellFamily: 'pwsh',
      executablePath: 'C:\\tools\\pwsh.exe',
      args: [],
      available: true,
      recommended: true
    };
    const detailCatalog: CatalogSnapshot = {
      ...readyCatalog,
      workspaces: [
        {
          ...readyCatalog.workspaces[0]!,
          canonicalPath: 'D:\\Projects\\AI\\Lumora-fresh'
        }
      ]
    };
    let unfilteredReads = 0;
    const getCatalog = vi.fn(async (query: { text: string }) => {
      if (query.text === 'hidden') {
        return { ...readyCatalog, sessions: [] };
      }
      unfilteredReads += 1;
      return unfilteredReads === 1 ? readyCatalog : detailCatalog;
    });
    const refreshCatalog = vi
      .fn()
      .mockResolvedValueOnce(readyCatalog)
      .mockResolvedValue(detailCatalog);
    setSystemInfoResult(undefined, undefined, {
      getCatalog,
      getTerminalProfiles: vi.fn().mockResolvedValue([profile]),
      prepareLaunch: vi.fn(() => new Promise<LaunchPreview>(() => undefined)),
      refreshCatalog
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(await screen.findByText('Catalog implementation')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: 'hidden' }
    });
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith({ text: 'hidden', provider: null })
    );
    expect(screen.getByText('No sessions match these filters')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open sessions for Lumora at D:\\Projects\\AI\\Lumora'
      })
    );

    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith({ text: '', provider: null })
    );
    expect(
      await screen.findByRole('heading', { name: 'Lumora sessions' })
    ).toBeInTheDocument();
    expect(screen.getByText('Catalog implementation')).toBeInTheDocument();

    refreshCatalog.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh sessions' }));
    await waitFor(() =>
      expect(refreshCatalog).toHaveBeenCalledWith({ text: '', provider: null })
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Resume Catalog implementation'
      })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Resume session' });
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText('D:\\Projects\\AI\\Lumora-fresh')
    ).toBeInTheDocument();
  });

  it('keeps workspace-detail refresh errors inside the detail route', async () => {
    const refreshCatalog = vi
      .fn()
      .mockResolvedValueOnce(readyCatalog)
      .mockRejectedValueOnce(new Error('detail scan failed'));
    setSystemInfoResult(undefined, undefined, { refreshCatalog });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open sessions for Lumora at D:\\Projects\\AI\\Lumora'
      })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Refresh sessions' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace sessions refresh failed. Last saved data is still shown.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to workspaces' }));

    expect(
      screen.queryByText(
        'Workspace sessions refresh failed. Last saved data is still shown.'
      )
    ).not.toBeInTheDocument();
  });

  it('ignores a workspace-detail response after returning to the list', async () => {
    const detail = deferred<CatalogSnapshot>();
    const getCatalog = vi
      .fn()
      .mockResolvedValueOnce(readyCatalog)
      .mockImplementation(() => detail.promise);
    setSystemInfoResult(undefined, undefined, { getCatalog });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open sessions for Lumora at D:\\Projects\\AI\\Lumora'
      })
    );
    expect(screen.getByText('Loading workspace sessions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to workspaces' }));

    await act(async () => detail.resolve(readyCatalog));

    expect(
      screen.getByRole('button', {
        name: 'Open sessions for Lumora at D:\\Projects\\AI\\Lumora'
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Lumora sessions' })
    ).not.toBeInTheDocument();
  });

  it('debounces session search and applies provider filters immediately', async () => {
    const getCatalog = vi
      .fn()
      .mockResolvedValueOnce(readyCatalog)
      .mockImplementation(async (query: CatalogQuery) => ({
        ...readyCatalog,
        sessions: [],
        providerFacets:
          query.provider === 'claude'
            ? [{ provider: 'codex' as const, sessionCount: 1 }]
            : readyCatalog.providerFacets
      }));
    setSystemInfoResult(undefined, undefined, { getCatalog });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(await screen.findByText('Catalog implementation')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: 'catalog' }
    });

    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith({ text: 'catalog', provider: null })
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), {
      target: { value: 'claude' }
    });
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith({
        text: 'catalog',
        provider: 'claude'
      })
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Provider' })).toHaveValue('')
    );
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith({
        text: 'catalog',
        provider: null
      })
    );
    expect(screen.getByText('No sessions match these filters')).toBeInTheDocument();
  });

  it('keeps the last good snapshot visible when background refresh fails', async () => {
    setSystemInfoResult(undefined, undefined, {
      refreshCatalog: vi.fn().mockRejectedValue(new Error('scan failed'))
    });
    render(<App />);

    expect(await screen.findByText('1 workspace')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Catalog refresh failed. Last saved data is still shown.'
    );
    expect(screen.getByText('Catalog implementation')).toBeInTheDocument();
  });

  it('recovers from an initial catalog read failure through Try again', async () => {
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockRejectedValue(new Error('database unavailable')),
      refreshCatalog: vi.fn().mockResolvedValue(readyCatalog)
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Catalog unavailable'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Lumora' })
    ).toBeInTheDocument();
  });

  it('ignores a stale search response that resolves after a newer query', async () => {
    const first = deferred<CatalogSnapshot>();
    const second = deferred<CatalogSnapshot>();
    const getCatalog = vi
      .fn()
      .mockResolvedValueOnce(readyCatalog)
      .mockImplementation((query: { text: string }) =>
        query.text === 'first' ? first.promise : second.promise
      );
    setSystemInfoResult(undefined, undefined, { getCatalog });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(await screen.findByText('Catalog implementation')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search sessions' });
    fireEvent.change(search, { target: { value: 'first' } });
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith({ text: 'first', provider: null })
    );
    fireEvent.change(search, { target: { value: 'second' } });
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith({ text: 'second', provider: null })
    );

    const secondSnapshot: CatalogSnapshot = {
      ...readyCatalog,
      sessions: [{ ...readyCatalog.sessions[0]!, title: 'Second result' }]
    };
    await act(async () => second.resolve(secondSnapshot));
    expect(await screen.findByText('Second result')).toBeInTheDocument();

    const staleSnapshot: CatalogSnapshot = {
      ...readyCatalog,
      sessions: [{ ...readyCatalog.sessions[0]!, title: 'Stale first result' }]
    };
    await act(async () => first.resolve(staleSnapshot));
    expect(screen.getByText('Second result')).toBeInTheDocument();
    expect(screen.queryByText('Stale first result')).not.toBeInTheDocument();
  });

  it('clears obsolete refresh activity when a newer search takes ownership', async () => {
    const getCatalog = vi
      .fn()
      .mockResolvedValueOnce(readyCatalog)
      .mockResolvedValue({ ...readyCatalog, sessions: [] });
    setSystemInfoResult(undefined, undefined, {
      getCatalog,
      refreshCatalog: vi.fn(() => new Promise<CatalogSnapshot>(() => {}))
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(await screen.findByText('Catalog implementation')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Refreshing catalog' })
    ).toBeDisabled();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: 'new query' }
    });
    await waitFor(() =>
      expect(getCatalog).toHaveBeenCalledWith({
        text: 'new query',
        provider: null
      })
    );

    expect(
      screen.getByRole('button', { name: 'Refresh catalog' })
    ).toBeEnabled();
  });

  it('holds startup through the real catalog refresh instead of showing cached zero counts', async () => {
    const cachedCatalog: CatalogSnapshot = {
      ...readyCatalog,
      workspaces: [],
      sessions: [],
      providerFacets: []
    };
    const refreshed = deferred<CatalogSnapshot>();
    const claimStartupPresentation = vi.fn().mockResolvedValue(true);
    setSystemInfoResult(undefined, undefined, {
      claimStartupPresentation,
      getCatalog: vi.fn().mockResolvedValue(cachedCatalog),
      refreshCatalog: vi.fn(() => refreshed.promise)
    });

    render(<App />);

    await waitFor(() =>
      expect(claimStartupPresentation).toHaveBeenCalledTimes(1)
    );
    const video = await waitFor(() => {
      const element = document.querySelector('video');
      expect(element).not.toBeNull();
      return element!;
    });
    await waitFor(() =>
      expect(screen.getByText('Loading catalog')).toBeInTheDocument()
    );

    fireEvent.ended(video);
    expect(
      screen.getByRole('img', { name: 'Lumora startup final frame' })
    ).toBeVisible();
    expect(
      screen.getByRole('status', { name: 'Lumora is starting' })
    ).toHaveAttribute('data-state', 'holding-final-frame');

    await act(async () => refreshed.resolve(readyCatalog));

    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Lumora is starting' })
      ).not.toBeInTheDocument()
    );
    expect(screen.getByText('Catalog implementation')).toBeInTheDocument();
  });

  it('does not settle startup from StrictMode provider scans that were superseded', async () => {
    const firstScan = deferred<ProviderScanResult>();
    const activeScan = deferred<ProviderScanResult>();
    const scanProviders = vi
      .fn()
      .mockImplementationOnce(() => firstScan.promise)
      .mockImplementationOnce(() => activeScan.promise);
    setSystemInfoResult(undefined, scanProviders, {
      claimStartupPresentation: vi.fn().mockResolvedValue(true)
    });

    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    await waitFor(() => expect(scanProviders).toHaveBeenCalledTimes(2));
    const video = await waitFor(() => {
      const element = document.querySelector('video');
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.ended(video);

    await act(async () => firstScan.resolve(readyProviderScan));

    expect(
      screen.getByRole('status', { name: 'Lumora is starting' })
    ).toHaveAttribute('data-state', 'holding-final-frame');

    await act(async () => activeScan.resolve(readyProviderScan));
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Lumora is starting' })
      ).not.toBeInTheDocument()
    );
  });
});
