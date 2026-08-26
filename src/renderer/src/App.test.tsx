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
  CatalogSnapshot,
  DeveloperEnvironmentScanResult,
  LaunchPreview,
  ProviderScanResult,
  RuntimeEvent,
  RuntimeSummary,
  StructuredAgentEvent,
  StructuredAgentRuntimeSnapshot,
  StructuredAgentRuntimeSummary,
  SystemInfo,
  TerminalProfile
} from '../../shared/contracts';
import App from './App';
import { CATALOG_EXIT_REFRESH_DELAY_MS } from './catalog/useCatalogAutoRefresh';
import { SIDEBAR_EXPANSION_STORAGE_KEY } from './sidebar/sidebar-preference';
import {
  renderWithLocalization,
  TestLocalizationProvider
} from './test/render-with-localization';

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
        <div
          aria-label={`${runtime.provider} terminal`}
          className="managed-terminal"
        >
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
        </div>
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
  onApplicationQuitRequest?: (
    listener: (request: {
      localActiveAgentCount: number;
      remoteActiveAgentCount: number;
      totalActiveAgentCount: number;
    }) => void
  ) => () => void;
  resolveApplicationQuit?: ReturnType<typeof vi.fn>;
  claimStartupPresentation?: ReturnType<typeof vi.fn>;
  completeStartupPresentation?: ReturnType<typeof vi.fn>;
  scanDeveloperEnvironment?: ReturnType<typeof vi.fn>;
  checkProviderUpdates?: ReturnType<typeof vi.fn>;
  openNodeDownloadPage?: ReturnType<typeof vi.fn>;
  getCatalog?: ReturnType<typeof vi.fn>;
  refreshCatalog?: ReturnType<typeof vi.fn>;
  chooseWorkspace?: ReturnType<typeof vi.fn>;
  getWorkspaceVisibilityPolicies?: ReturnType<typeof vi.fn>;
  setWorkspaceVisibilityPolicy?: ReturnType<typeof vi.fn>;
  restoreWorkspaceVisibility?: ReturnType<typeof vi.fn>;
  restoreAllWorkspaceVisibility?: ReturnType<typeof vi.fn>;
  getTerminalProfiles?: ReturnType<typeof vi.fn>;
  getGeneralSettings?: ReturnType<typeof vi.fn>;
  onGeneralSettingsChanged?: (listener: () => void) => () => void;
  getAppearanceBackground?: ReturnType<typeof vi.fn>;
  getThemePresets?: ReturnType<typeof vi.fn>;
  chooseAppearanceBackground?: ReturnType<typeof vi.fn>;
  removeAppearanceBackground?: ReturnType<typeof vi.fn>;
  saveGeneralSettings?: ReturnType<typeof vi.fn>;
  getKeyboardSettings?: ReturnType<typeof vi.fn>;
  readClipboardText?: ReturnType<typeof vi.fn>;
  writeClipboardText?: ReturnType<typeof vi.fn>;
  prepareLaunch?: ReturnType<typeof vi.fn>;
  startRuntime?: ReturnType<typeof vi.fn>;
  startAgentRuntime?: ReturnType<typeof vi.fn>;
  listStructuredRuntimes?: ReturnType<typeof vi.fn>;
  getStructuredRuntimeSnapshot?: ReturnType<typeof vi.fn>;
  closeStructuredRuntime?: ReturnType<typeof vi.fn>;
  reconnectStructuredRuntime?: ReturnType<typeof vi.fn>;
  onStructuredAgentEvent?: (
    listener: (event: StructuredAgentEvent) => void
  ) => () => void;
  attachRuntime?: ReturnType<typeof vi.fn>;
  listRuntimes?: ReturnType<typeof vi.fn>;
  onRuntimeEvent?: (
    listener: (event: RuntimeEvent) => void
  ) => () => void;
  onTrayResumeSessionRequested?: (
    listener: (sessionId: string) => void
  ) => () => void;
  getTransferCapabilities?: ReturnType<typeof vi.fn>;
  prepareSessionExport?: ReturnType<typeof vi.fn>;
  executeSessionExport?: ReturnType<typeof vi.fn>;
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
  const startRuntime = catalogApi.startRuntime ?? vi.fn();
  const startAgentRuntime = catalogApi.startAgentRuntime ?? vi.fn(
    async (launchToken: string) => ({
      mode: 'pty' as const,
      routeReason: 'unavailable' as const,
      runtime: await (startRuntime as unknown as (
        token: string
      ) => Promise<RuntimeSummary>)(launchToken)
    })
  );
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: {
      onApplicationQuitRequest:
        catalogApi.onApplicationQuitRequest ?? vi.fn(() => () => undefined),
      resolveApplicationQuit:
        catalogApi.resolveApplicationQuit ?? vi.fn().mockResolvedValue(true),
      claimStartupPresentation:
        catalogApi.claimStartupPresentation ?? vi.fn().mockResolvedValue(false),
      completeStartupPresentation:
        catalogApi.completeStartupPresentation ??
        vi.fn().mockResolvedValue(undefined),
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
      getWorkspaceVisibilityPolicies:
        catalogApi.getWorkspaceVisibilityPolicies ?? vi.fn().mockResolvedValue([]),
      setWorkspaceVisibilityPolicy:
        catalogApi.setWorkspaceVisibilityPolicy ?? vi.fn().mockResolvedValue([]),
      restoreWorkspaceVisibility:
        catalogApi.restoreWorkspaceVisibility ?? vi.fn().mockResolvedValue([]),
      restoreAllWorkspaceVisibility:
        catalogApi.restoreAllWorkspaceVisibility ?? vi.fn().mockResolvedValue([]),
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
      checkProviderUpdates:
        catalogApi.checkProviderUpdates ?? vi.fn().mockResolvedValue({
          checkedAt: '2026-08-24T01:00:00.000Z',
          providers: []
        }),
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
      onGeneralSettingsChanged:
        catalogApi.onGeneralSettingsChanged ?? vi.fn(() => () => undefined),
      getAppearanceBackground:
        catalogApi.getAppearanceBackground ??
        vi.fn().mockResolvedValue({ available: false, revision: null }),
      chooseAppearanceBackground:
        catalogApi.chooseAppearanceBackground ??
        vi.fn().mockResolvedValue({ available: false, revision: null }),
      removeAppearanceBackground:
        catalogApi.removeAppearanceBackground ??
        vi.fn().mockResolvedValue({ available: false, revision: null }),
      getThemePresets: catalogApi.getThemePresets ?? vi.fn().mockResolvedValue({
        presets: [],
        rejectedCount: 0
      }),
      openThemePresetFolder: vi.fn().mockResolvedValue(undefined),
      getWorkspaceTrustDecisions: vi.fn().mockResolvedValue([]),
      trustWorkspaceForLaunch: vi.fn(),
      revokeWorkspaceTrust: vi.fn().mockResolvedValue([]),
      prepareLaunch: catalogApi.prepareLaunch ?? vi.fn(),
      startRuntime,
      startAgentRuntime,
      listStructuredRuntimes:
        catalogApi.listStructuredRuntimes ?? vi.fn().mockResolvedValue([]),
      getStructuredRuntimeSnapshot:
        catalogApi.getStructuredRuntimeSnapshot ?? vi.fn(),
      closeStructuredRuntime:
        catalogApi.closeStructuredRuntime ?? vi.fn(),
      reconnectStructuredRuntime:
        catalogApi.reconnectStructuredRuntime ?? vi.fn(),
      dispatchStructuredAgentAction: vi.fn().mockResolvedValue(undefined),
      onStructuredAgentEvent:
        catalogApi.onStructuredAgentEvent ?? vi.fn(() => () => undefined),
      listRuntimes: catalogApi.listRuntimes ?? vi.fn().mockResolvedValue([]),
      attachRuntime: catalogApi.attachRuntime ?? vi.fn(),
      writeRuntime: vi.fn().mockResolvedValue(undefined),
      resizeRuntime: vi.fn().mockResolvedValue(undefined),
      terminateRuntime: vi.fn(),
      onRuntimeEvent:
        catalogApi.onRuntimeEvent ?? vi.fn(() => () => undefined),
      onTrayResumeSessionRequested:
        catalogApi.onTrayResumeSessionRequested ??
        vi.fn(() => () => undefined),
      listRemoteTargets: vi.fn().mockResolvedValue([]),
      getTransferCapabilities:
        catalogApi.getTransferCapabilities ?? vi.fn().mockResolvedValue([]),
      prepareSessionExport: catalogApi.prepareSessionExport ?? vi.fn(),
      executeSessionExport: catalogApi.executeSessionExport ?? vi.fn(),
      chooseSessionImportArchive: vi.fn().mockResolvedValue(null),
      inspectSessionImport: vi.fn(),
      planSessionImport: vi.fn(),
      executeSessionImport: vi.fn(),
      chooseTransferWorkspace: vi.fn().mockResolvedValue(null),
      getTransferHistory: vi.fn().mockResolvedValue([]),
      cancelTransferOperation: vi.fn().mockResolvedValue(undefined),
      onTransferEvent: vi.fn(() => () => undefined)
    }
  });
}

function createLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}

describe('App', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: createLocalStorage()
    });
    setSystemInfoResult();
  });

  it('restores a structured provider session into the persistent agent workspace', async () => {
    const runtime: StructuredAgentRuntimeSummary = {
      connectionId: 'structured-codex-1',
      providerId: 'codex',
      nativeSessionId: 'native-codex-1',
      catalogSessionId: readyCatalog.sessions[0]!.id,
      workspaceId: readyCatalog.workspaces[0]!.id,
      title: 'Catalog implementation',
      state: 'ready',
      generation: 1,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:01.000Z',
      error: null
    };
    const snapshot: StructuredAgentRuntimeSnapshot = {
      runtime,
      boundary: null,
      events: [{
        kind: 'assistant.message',
        connectionId: runtime.connectionId,
        providerId: 'codex',
        nativeSessionId: runtime.nativeSessionId,
        generation: 1,
        sequence: 1,
        eventId: 'event-1',
        parentEventId: null,
        timestamp: runtime.updatedAt,
        turnId: 'turn-1',
        payload: { text: 'The catalog is ready.' }
      }]
    };
    setSystemInfoResult(undefined, undefined, {
      listStructuredRuntimes: vi.fn().mockResolvedValue([runtime]),
      getStructuredRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot)
    });

    renderWithLocalization(<App />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Open terminals'
    }));
    expect(await screen.findByRole('region', {
      name: 'Unified agent sessions'
    })).toBeInTheDocument();
    expect(screen.getByText('The catalog is ready.')).toBeVisible();
    expect(screen.getByText('1 active agent')).toBeInTheDocument();
  });

  it('keeps the next structured session visible when the active one closes', async () => {
    const first: StructuredAgentRuntimeSummary = {
      connectionId: 'structured-first',
      providerId: 'codex',
      nativeSessionId: 'native-first',
      catalogSessionId: readyCatalog.sessions[0]!.id,
      workspaceId: readyCatalog.workspaces[0]!.id,
      title: 'First structured session',
      state: 'ready',
      generation: 1,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:01.000Z',
      error: null
    };
    const second: StructuredAgentRuntimeSummary = {
      ...first,
      connectionId: 'structured-second',
      nativeSessionId: 'native-second',
      catalogSessionId: null,
      title: 'Second structured session'
    };
    let eventListener: ((event: StructuredAgentEvent) => void) | undefined;
    setSystemInfoResult(undefined, undefined, {
      listStructuredRuntimes: vi.fn().mockResolvedValue([first, second]),
      getStructuredRuntimeSnapshot: vi.fn(async (connectionId: string) => ({
        runtime: connectionId === first.connectionId ? first : second,
        boundary: null,
        events: []
      })),
      onStructuredAgentEvent: (listener) => {
        eventListener = listener;
        return () => undefined;
      }
    });
    renderWithLocalization(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open terminals' }));
    expect(await screen.findByRole('heading', {
      name: 'First structured session'
    })).toBeVisible();

    act(() => eventListener?.({
      kind: 'runtime.status',
      connectionId: first.connectionId,
      providerId: first.providerId,
      nativeSessionId: first.nativeSessionId,
      generation: 1,
      sequence: 1,
      eventId: 'closed-event',
      parentEventId: null,
      timestamp: '2026-08-27T00:01:00.000Z',
      turnId: 'lifecycle',
      payload: { state: 'closed', message: null }
    }));

    expect(await screen.findByRole('heading', {
      name: 'Second structured session'
    })).toBeVisible();
  });

  it('warns before exiting with active local or remote agents', async () => {
    let quitListener: ((request: {
      localActiveAgentCount: number;
      remoteActiveAgentCount: number;
      totalActiveAgentCount: number;
    }) => void) | undefined;
    const resolveApplicationQuit = vi.fn().mockResolvedValue(true);
    setSystemInfoResult(undefined, undefined, {
      onApplicationQuitRequest: (listener) => {
        quitListener = listener;
        return () => undefined;
      },
      resolveApplicationQuit
    });
    renderWithLocalization(<App />);

    act(() => quitListener?.({
      localActiveAgentCount: 1,
      remoteActiveAgentCount: 2,
      totalActiveAgentCount: 3
    }));
    const dialog = screen.getByRole('dialog', { name: 'Exit Lumora?' });
    expect(within(dialog).getByText(/1 local and 2 remote/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('checkbox', {
      name: "Don't show this warning again"
    }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Exit Lumora' }));

    await waitFor(() => expect(resolveApplicationQuit).toHaveBeenCalledWith({
      action: 'exit',
      suppressFutureWarning: true
    }));
  });

  it('uses the canonical Lumora brand artwork in the sidebar', () => {
    renderWithLocalization(<App />);

    const brand = screen.getByRole('button', { name: 'Collapse sidebar' });
    const mark = brand.querySelector<HTMLImageElement>('img.brand-mark');

    expect(brand).toHaveClass('brand');
    expect(brand).toHaveAttribute('aria-expanded', 'true');
    expect(brand.querySelector('strong')).toHaveTextContent('Lumora');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('alt', '');
    expect(mark).toHaveAttribute('src', lumoraBrandMarkUrl);
  });

  it('does not show static discovery badges in the app chrome', () => {
    renderWithLocalization(<App />);

    expect(screen.queryByText('Discovery mode')).not.toBeInTheDocument();
    expect(document.querySelector('.sidebar-note')).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Session actions' })
    ).not.toHaveTextContent('Provider discovery');
    expect(document.querySelector('.release-badge')).not.toBeInTheDocument();
  });

  it('shows the live local agent count instead of the obsolete local-only label', async () => {
    renderWithLocalization(<App />);

    expect(await screen.findByText('0 active agents')).toBeInTheDocument();
    expect(screen.queryByText('Local only')).not.toBeInTheDocument();
  });

  it('uses singular and plural labels for active local agents', async () => {
    const first = runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789b01');
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([first]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime: first,
        snapshot: '',
        outputSequence: 0
      })
    });
    const { unmount } = renderWithLocalization(<App />);

    expect(await screen.findByText('1 active agent')).toBeInTheDocument();
    unmount();

    const second = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789b02',
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
    renderWithLocalization(<App />);

    expect(await screen.findByText('2 active agents')).toBeInTheDocument();
  });

  it('restores and persists the sidebar expansion state', async () => {
    window.localStorage.setItem(
      SIDEBAR_EXPANSION_STORAGE_KEY,
      'collapsed'
    );

    renderWithLocalization(<App />);

    const shell = document.querySelector('.app-shell');
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(shell).toHaveClass('sidebar-collapsed');
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(expand);

    await waitFor(() => {
      expect(
        window.localStorage.getItem(SIDEBAR_EXPANSION_STORAGE_KEY)
      ).toBe('expanded');
    });
    expect(shell).not.toHaveClass('sidebar-collapsed');
  });

  it('collapses and expands the sidebar without remounting navigation icons', async () => {
    renderWithLocalization(<App />);

    const shell = document.querySelector('.app-shell');
    const home = screen.getByRole('button', { name: 'Home' });
    const homeIcon = home.querySelector('.icon');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(shell).toHaveClass('sidebar-collapsed');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(expand).not.toHaveAttribute('title');
    expect(home).not.toHaveAttribute('title');
    await screen.findByText('Windows · x64');
    fireEvent.pointerEnter(home);
    const homeTooltip = await screen.findByRole('tooltip');
    expect(homeTooltip).toHaveTextContent('Home');
    expect(homeTooltip).toHaveTextContent('Ctrl + 1');
    fireEvent.pointerLeave(home);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
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

  it('keeps the latest sidebar state, preference, and icon identity after repeated toggles', async () => {
    renderWithLocalization(<App />);

    const shell = document.querySelector('.app-shell');
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    const home = screen.getByRole('button', { name: 'Home' });
    const homeIcon = home.querySelector('.icon');

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(shell).toHaveClass('sidebar-collapsed');
    await waitFor(() => {
      expect(
        window.localStorage.getItem(SIDEBAR_EXPANSION_STORAGE_KEY)
      ).toBe('collapsed');
    });
    expect(home.querySelector('.icon')).toBe(homeIcon);

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(shell).not.toHaveClass('sidebar-collapsed');
    await waitFor(() => {
      expect(
        window.localStorage.getItem(SIDEBAR_EXPANSION_STORAGE_KEY)
      ).toBe('expanded');
    });
    expect(home.querySelector('.icon')).toBe(homeIcon);
  });

  it('uses customized platform-aware shortcuts in collapsed sidebar tooltips', async () => {
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
    renderWithLocalization(<App />);

    await waitFor(() => expect(getKeyboardSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    const home = screen.getByRole('button', { name: 'Home' });
    expect(home).not.toHaveAttribute('title');
    await screen.findByText('macOS · arm64');
    fireEvent.pointerEnter(home);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Home');
    expect(tooltip).toHaveTextContent('⇧ + ⌘ + H');
  });

  it('expands while navigating from a collapsed sidebar', () => {
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
      'Remote computers'
    ]) {
      expect(screen.getByRole('button', { name: destination })).toBeInTheDocument();
    }
  });

  it('places Remote computers fifth and Settings below the separator', () => {
    renderWithLocalization(<App />);

    const primaryNavigation = screen.getByRole('navigation', {
      name: 'Primary navigation'
    });
    const applicationNavigation = screen.getByRole('navigation', {
      name: 'Application'
    });

    expect(within(primaryNavigation).getAllByRole('button').map(
      (button) => button.textContent
    )).toEqual([
      'Home',
      'Workspaces',
      'All sessions',
      'Terminal profiles',
      'Remote computers'
    ]);
    expect(within(primaryNavigation).queryByRole('button', {
      name: 'Settings'
    })).not.toBeInTheDocument();
    expect(within(applicationNavigation).getByRole('button', {
      name: 'Settings'
    })).toBeInTheDocument();
    expect(applicationNavigation).toHaveClass('sidebar-remote-nav');
  });

  it('resets the shared page scroll position when navigation changes', async () => {
    renderWithLocalization(<App />);
    const main = document.getElementById('main-content');
    expect(main).not.toBeNull();
    if (main === null) throw new Error('main content missing');
    main.scrollTop = 480;

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));

    await waitFor(() => expect(main.scrollTop).toBe(0));
  });

  it('exports selected sessions through the app-level workflow', async () => {
    const prepareSessionExport = vi.fn().mockResolvedValue({
      planToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      sessions: [
        {
          sessionId: readyCatalog.sessions[0]!.id,
          nativeSessionId: readyCatalog.sessions[0]!.nativeId,
          provider: 'codex',
          title: readyCatalog.sessions[0]!.title,
          workspaceId: readyCatalog.sessions[0]!.workspaceId,
          estimatedBytes: 1_024
        }
      ],
      skipped: [],
      estimatedBytes: 1_024,
      expiresAt: '2026-07-29T13:00:00.000Z'
    });
    const executeSessionExport = vi.fn().mockResolvedValue({
      operationId: '0198f8b6-18f3-7ca0-9f0f-abcdefabcdef',
      direction: 'export',
      completedAt: '2026-07-29T12:00:00.000Z',
      status: 'completed',
      importedCount: 0,
      exportedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      providers: ['codex'],
      items: []
    });
    setSystemInfoResult(undefined, undefined, {
      getTransferCapabilities: vi.fn().mockResolvedValue([
        {
          provider: 'codex',
          displayName: 'Codex',
          exportSupport: 'supported',
          routes: [],
          installGuidance: null
        }
      ]),
      prepareSessionExport,
      executeSessionExport
    });
    renderWithLocalization(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    await within(screen.getByRole('main')).findByText('Catalog implementation');
    expect(
      screen.queryByRole('button', { name: 'Select sessions to export' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Transfer' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Export sessions' })
    );
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Catalog implementation' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with 1 session' })
    );

    expect(await screen.findByText('1 ready to export')).toBeInTheDocument();
    expect(prepareSessionExport).toHaveBeenCalledWith({
      sessionIds: [readyCatalog.sessions[0]!.id]
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Encrypt archive' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose destination and export' })
    );

    await waitFor(() =>
      expect(executeSessionExport).toHaveBeenCalledWith({
        planToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
        protection: { encrypted: false }
      })
    );
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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    await within(screen.getByRole('main')).findByText('Catalog implementation');
    expect(screen.queryByText('A saved-preference warning.')).toBeNull();
  });

  it('reloads global General settings when another Lumora window changes them', async () => {
    let notifySettingsChanged: (() => void) | null = null;
    const getGeneralSettings = vi.fn()
      .mockResolvedValueOnce(DEFAULT_GENERAL_SETTINGS)
      .mockResolvedValue({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      });
    setSystemInfoResult(undefined, undefined, {
      getGeneralSettings,
      onGeneralSettingsChanged: (listener) => {
        notifySettingsChanged = listener;
        return () => { notifySettingsChanged = null; };
      }
    });
    renderWithLocalization(<App />);
    await waitFor(() => expect(getGeneralSettings).toHaveBeenCalledOnce());
    if (notifySettingsChanged === null) throw new Error('Missing settings listener.');

    act(() => notifySettingsChanged?.());
    await waitFor(() => expect(getGeneralSettings).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const informationSwitch = await screen.findByRole('switch', {
      name: 'Show informational notices'
    });
    await waitFor(() => expect(informationSwitch).not.toBeChecked());
  });

  it('restores the switch and shows an actionable error when saving fails', async () => {
    const saveGeneralSettings = vi
      .fn()
      .mockRejectedValue(new Error('storage unavailable'));
    setSystemInfoResult(undefined, undefined, { saveGeneralSettings });
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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

  it('renders only the opaque managed background URL when enabled', async () => {
    setSystemInfoResult(undefined, undefined, {
      getGeneralSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_GENERAL_SETTINGS,
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          backgroundEnabled: true
        }
      }),
      getAppearanceBackground: vi.fn().mockResolvedValue({
        available: true,
        revision: '1720000000000-4096'
      })
    });

    renderWithLocalization(<App />);

    await waitFor(() => {
      const layer = document.querySelector('.appearance-background-layer');
      expect(layer).toBeInTheDocument();
      expect(layer).toHaveStyle({
        backgroundImage:
          'url("app://appearance/background?revision=1720000000000-4096")'
      });
    });
    expect(document.querySelector('.app-shell')).toHaveClass(
      'has-appearance-background'
    );
    expect(document.querySelector('.app-shell')).not.toHaveClass(
      'has-surface-mosaic'
    );
    expect(document.querySelector('.app-shell')?.getAttribute('style')).not.toContain(
      '--appearance-surface-mosaic'
    );
    expect(document.querySelector('.app-shell')?.getAttribute('style')).toContain(
      '--appearance-terminal-opacity: 94%'
    );
    expect(document.querySelector('.app-shell')?.getAttribute('style')).toContain(
      '--appearance-opacity-recessed: 90.528%'
    );
    expect(document.querySelector('.app-shell')?.getAttribute('style')).toContain(
      '--appearance-opacity-normal: 92%'
    );
    expect(document.querySelector('.app-shell')?.getAttribute('style')).toContain(
      '--appearance-opacity-raised: 94.576%'
    );
    expect(document.querySelector('.app-shell')?.getAttribute('style')).toContain(
      '--appearance-opacity-popup: 97.2%'
    );
    expect(document.querySelector('.app-shell')?.getAttribute('style')).toContain(
      '--appearance-opacity-popup-raised: 98.153%'
    );
  });

  it('applies a selected data-only theme pack to the application shell', async () => {
    setSystemInfoResult(undefined, undefined, {
      getGeneralSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_GENERAL_SETTINGS,
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          theme: 'dark',
          themePresetId: 'midnight-cyan'
        }
      }),
      getThemePresets: vi.fn().mockResolvedValue({
        rejectedCount: 0,
        presets: [{
          id: 'midnight-cyan',
          displayName: 'Midnight cyan',
          baseTheme: 'dark',
          palette: {
            accent: '#22D3EE',
            onAccent: '#06202A',
            background: '#07111F',
            sidebar: '#081525',
            sidebarText: '#E6F7FF',
            surface: '#102033',
            surfaceRaised: '#172A40',
            control: '#1C334D',
            text: '#F3FAFF',
            textMuted: '#9CB2C8',
            border: '#39536D',
            success: '#41D6A3',
            warning: '#F2BE5C',
            danger: '#F4778A'
          }
        }]
      })
    });

    renderWithLocalization(<App />);

    await waitFor(() => {
      expect(document.querySelector('.app-shell')?.getAttribute('style'))
        .toContain('--blue: #22D3EE');
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('adds the surface mosaic layer only for a positive saved strength', async () => {
    setSystemInfoResult(undefined, undefined, {
      getGeneralSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_GENERAL_SETTINGS,
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          backgroundEnabled: true,
          surfaceMosaic: 12
        }
      }),
      getAppearanceBackground: vi.fn().mockResolvedValue({
        available: true,
        revision: '1720000000000-4096'
      })
    });

    renderWithLocalization(<App />);

    await waitFor(() => {
      const shell = document.querySelector('.app-shell');
      expect(shell).toHaveClass('has-appearance-background');
      expect(shell).toHaveClass('has-surface-mosaic');
      expect(shell?.getAttribute('style')).toContain(
        '--appearance-surface-mosaic: 12px'
      );
    });
  });

  it('marks an open terminal page as the active surface mosaic target', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ab1'
    );
    setSystemInfoResult(undefined, undefined, {
      getGeneralSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_GENERAL_SETTINGS,
        appearance: {
          ...DEFAULT_GENERAL_SETTINGS.appearance,
          backgroundEnabled: true,
          surfaceMosaic: 12
        }
      }),
      getAppearanceBackground: vi.fn().mockResolvedValue({
        available: true,
        revision: '1720000000000-4096'
      }),
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      })
    });

    renderWithLocalization(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );

    await waitFor(() => {
      expect(document.querySelector('.app-shell')).toHaveClass(
        'has-surface-mosaic',
        'terminal-active'
      );
      expect(document.querySelector('.terminal-workspace')).toBeInTheDocument();
    });
  });

  it('keeps a collapsed sidebar collapsed while navigating when auto-expand is disabled', async () => {
    const getGeneralSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_GENERAL_SETTINGS,
      autoExpandSidebar: false
    });
    setSystemInfoResult(undefined, undefined, { getGeneralSettings });
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);
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
    renderWithLocalization(<App />);

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

  it('uses the expanded sidebar to switch running sessions and resume recent sessions', async () => {
    const linkedSession = readyCatalog.sessions[0]!;
    const otherSession = {
      ...linkedSession,
      id: '9'.repeat(64),
      nativeId: 'codex-sidebar-recent',
      title: 'Sidebar recent work',
      updatedAt: '2026-07-11T03:30:00.000Z'
    };
    const catalog = {
      ...readyCatalog,
      sessions: [linkedSession, otherSession]
    };
    const runtime: RuntimeSummary = {
      ...runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789af0'),
      displayName: linkedSession.title,
      strategy: 'resume',
      sessionId: linkedSession.id,
      nativeSessionId: linkedSession.nativeId,
      reconciliationState: 'not_required'
    };
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
    let emitRuntime!: (event: RuntimeEvent) => void;
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockResolvedValue(catalog),
      refreshCatalog: vi.fn().mockResolvedValue(catalog),
      getTerminalProfiles: vi.fn().mockResolvedValue([profile]),
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      }),
      onRuntimeEvent: vi.fn((listener) => {
        emitRuntime = listener;
        return () => undefined;
      }),
      prepareLaunch: vi.fn(() => new Promise<LaunchPreview>(() => undefined))
    });
    renderWithLocalization(<App />);

    const runningRegion = await screen.findByRole('region', {
      name: 'Running sessions'
    });
    const recentRegion = await screen.findByRole('region', {
      name: 'Recent sessions'
    });
    expect(within(recentRegion).queryByText(linkedSession.title))
      .not.toBeInTheDocument();
    expect(within(recentRegion).getByText(otherSession.title)).toBeVisible();

    fireEvent.click(within(runningRegion).getByRole('button', {
      name: new RegExp(linkedSession.title)
    }));
    expect(await screen.findByRole('heading', { name: linkedSession.title }))
      .toBeInTheDocument();
    expect(document.querySelector('.terminal-tabbar')).toHaveAttribute('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByRole('region', { name: 'Running sessions' }))
      .not.toBeInTheDocument();
    expect(document.querySelector('.terminal-tabbar')).not.toHaveAttribute('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    act(() => {
      emitRuntime({
        type: 'state',
        runtimeId: runtime.id,
        runtime: {
          ...runtime,
          state: 'completed',
          endedAt: '2026-08-26T02:00:00.000Z',
          exitCode: 0
        }
      });
    });
    expect(screen.queryByRole('region', { name: 'Running sessions' }))
      .not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Recent sessions' }))
      .getByText(linkedSession.title)).toBeVisible();

    fireEvent.click(screen.getByRole('button', {
      name: new RegExp(otherSession.title)
    }));
    expect(await screen.findByRole('dialog', { name: 'Resume session' }))
      .toBeInTheDocument();
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
      renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, {
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });
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
      screen.getByRole('tab', { hidden: true, name: /Renamed provider session/ })
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
    renderWithLocalization(<App />);

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

  it('ignores the terminal switcher shortcut outside the terminal page', async () => {
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
    renderWithLocalization(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();

    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });

    expect(
      screen.queryByRole('dialog', { name: 'Open terminals' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
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
    renderWithLocalization(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    expect(
      await screen.findByRole('tab', { hidden: true, name: /Codex working session/ })
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
      screen.getByRole('tab', { hidden: true, name: /Claude working session/ })
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('cycles from a PTY terminal into a structured provider session', async () => {
    const pty = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789ad2'
    );
    const structured: StructuredAgentRuntimeSummary = {
      connectionId: 'structured-gemini-switcher',
      providerId: 'gemini',
      nativeSessionId: 'gemini-native-switcher',
      catalogSessionId: null,
      workspaceId: readyCatalog.workspaces[0]!.id,
      title: 'Gemini structured session',
      state: 'ready',
      generation: 1,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:01.000Z',
      error: null
    };
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([pty]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime: pty,
        snapshot: '',
        outputSequence: 0
      }),
      listStructuredRuntimes: vi.fn().mockResolvedValue([structured]),
      getStructuredRuntimeSnapshot: vi.fn().mockResolvedValue({
        runtime: structured,
        boundary: null,
        events: []
      })
    });
    renderWithLocalization(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open terminals' }));
    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });
    expect(screen.getByRole('option', {
      name: /Gemini structured session/
    })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyUp(window, { code: 'ControlLeft', key: 'Control' });

    expect(await screen.findByRole('heading', {
      name: 'Gemini structured session'
    })).toBeVisible();
  });

  it('keeps dragged visual tab order independent from the MRU switcher', async () => {
    const first = {
      ...runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789af0'),
      displayName: 'First session'
    };
    const second = {
      ...runningRuntime(
        '0198f8b6-18f3-7ca0-9f0f-123456789af1',
        'claude'
      ),
      displayName: 'Second session'
    };
    const third = {
      ...runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789af2'),
      displayName: 'Third session'
    };
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([first, second, third]),
      attachRuntime: vi.fn(async (runtimeId: string) => ({
        runtime: [first, second, third].find((item) => item.id === runtimeId)!,
        snapshot: '',
        outputSequence: 0
      }))
    });
    renderWithLocalization(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    fireEvent.click(
      await screen.findByRole('tab', { hidden: true, name: /Third session/ })
    );
    const firstTab = screen.getByRole('tab', { hidden: true, name: /First session/ });
    fireEvent.keyDown(firstTab, {
      altKey: true,
      code: 'ArrowRight',
      key: 'ArrowRight',
      shiftKey: true
    });

    expect(
      screen.getAllByRole('tab', { hidden: true }).map((tab) => tab.textContent)
    ).toEqual([
      expect.stringContaining('Second session'),
      expect.stringContaining('First session'),
      expect.stringContaining('Third session')
    ]);

    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });
    expect(
      screen.getByRole('option', { name: /First session/ })
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
    renderWithLocalization(<App />);

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
    expect(screen.getByRole('tab', { hidden: true, name: /Third session/ }))
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
    renderWithLocalization(<App />);

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
      screen.getByRole('tab', { hidden: true, name: /Codex working session/ })
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('navigates primary pages with the default application shortcuts', async () => {
    renderWithLocalization(<App />);

    fireEvent.keyDown(window, { code: 'Digit2', key: '2', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Digit3', key: '3', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'All sessions' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Digit4', key: '4', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Terminal profiles' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Digit5', key: '5', ctrlKey: true });
    expect(screen.getByRole('button', {
      name: 'Remote computers'
    })).toHaveAttribute('aria-current', 'page');
    fireEvent.keyDown(window, { code: 'Digit1', key: '1', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'Comma', key: ',', ctrlKey: true });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens and refocuses a live terminal with Ctrl+Shift+T', async () => {
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
    renderWithLocalization(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, {
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });
    const terminalInput = await screen.findByRole('button', {
      name: 'Codex working session terminal input'
    });
    expect(screen.getByRole('tab', { hidden: true, name: /Codex working session/ }))
      .toHaveAttribute('aria-selected', 'true');
    expect(terminalInput).toHaveFocus();

    screen.getByRole('button', { name: 'Collapse sidebar' }).focus();
    expect(terminalInput).not.toHaveFocus();
    fireEvent.keyDown(window, {
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });
    expect(terminalInput).toHaveFocus();
  });

  it('applies configured Lumora shortcuts while terminal input is focused', async () => {
    const runtime = runningRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789adf'
    );
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      })
    });
    renderWithLocalization(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open terminals' })
    );
    const terminalInput = await screen.findByRole('button', {
      name: 'Codex working session terminal input'
    });
    expect(terminalInput).toHaveFocus();

    const openTerminalEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });
    terminalInput.dispatchEvent(openTerminalEvent);
    expect(openTerminalEvent.defaultPrevented).toBe(true);
    expect(terminalInput).toHaveFocus();

    const homeEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Digit1',
      key: '1',
      ctrlKey: true
    });
    terminalInput.dispatchEvent(homeEvent);
    expect(homeEvent.defaultPrevented).toBe(true);
    expect(
      await screen.findByRole('heading', { name: 'Home' })
    ).toBeInTheDocument();
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
    renderWithLocalization(<App />);

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

  it('keeps the selected terminal when Ctrl+Shift+T is pressed away from terminal input', async () => {
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
    renderWithLocalization(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, {
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });
    fireEvent.click(
      await screen.findByRole('tab', { hidden: true, name: /Claude working session/ })
    );
    const secondInput = screen.getByRole('button', {
      name: 'Claude working session terminal input'
    });
    screen.getByRole('button', { name: 'Collapse sidebar' }).focus();

    fireEvent.keyDown(window, {
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });

    expect(screen.getByRole('tab', { hidden: true, name: /Claude working session/ }))
      .toHaveAttribute('aria-selected', 'true');
    expect(secondInput).toHaveFocus();
  });

  it('restores the previously selected terminal with Ctrl+Shift+T after navigating away', async () => {
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
    renderWithLocalization(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, {
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });
    fireEvent.click(
      await screen.findByRole('tab', { hidden: true, name: /Claude working session/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(screen.getByRole('heading', { name: 'All sessions' }))
      .toBeInTheDocument();

    fireEvent.keyDown(window, {
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });

    expect(screen.getByRole('tab', { hidden: true, name: /Claude working session/ }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', {
      name: 'Claude working session terminal input'
    })).toHaveFocus();
  });

  it('uses current runtime state when a previously registered Ctrl+Shift+T listener fires', async () => {
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
      renderWithLocalization(<App />);
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
          key: 'T',
          ctrlKey: true,
          shiftKey: true
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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

    await screen.findByRole('button', { name: 'Open terminals' });
    fireEvent.keyDown(window, {
      code: 'KeyT',
      key: 'T',
      ctrlKey: true,
      shiftKey: true
    });
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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    const dialog = await screen.findByRole('dialog', { name: 'Resume session' });
    expect(within(dialog).getByText('Catalog implementation')).toBeInTheDocument();
    expect(within(dialog).getByText('Codex')).toBeInTheDocument();
    expect(within(dialog).getByText('Lumora')).toBeInTheDocument();
  });

  it('opens the existing terminal when Home selects a running session', async () => {
    const runtime = {
      ...runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789aa1'),
      displayName: readyCatalog.sessions[0]!.title,
      strategy: 'resume' as const,
      sessionId: readyCatalog.sessions[0]!.id,
      nativeSessionId: readyCatalog.sessions[0]!.nativeId,
      reconciliationState: 'not_required' as const
    };
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      })
    });
    renderWithLocalization(<App />);

    fireEvent.click(await screen.findByRole('button', {
      name: `Open running terminal ${readyCatalog.sessions[0]!.title}`
    }));

    expect(screen.queryByRole('dialog', { name: 'Resume session' }))
      .not.toBeInTheDocument();
    expect(await screen.findByRole('button', {
      name: `${runtime.displayName} terminal input`
    })).toHaveFocus();
  });

  it('opens the normal resume confirmation when the tray requests a recent session', async () => {
    let requestResume!: (sessionId: string) => void;
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
      prepareLaunch: vi.fn(() => new Promise<LaunchPreview>(() => undefined)),
      onTrayResumeSessionRequested: vi.fn((listener) => {
        requestResume = listener;
        return () => undefined;
      })
    });
    renderWithLocalization(<App />);
    await screen.findByRole('button', { name: 'Resume' });

    act(() => requestResume(readyCatalog.sessions[0]!.id));

    const dialog = await screen.findByRole('dialog', { name: 'Resume session' });
    expect(within(dialog).getByText('Catalog implementation')).toBeInTheDocument();
    expect(within(dialog).getByText('Lumora')).toBeInTheDocument();
  });

  it('opens the existing terminal when the tray selects a running session', async () => {
    let requestResume!: (sessionId: string) => void;
    const runtime = {
      ...runningRuntime('0198f8b6-18f3-7ca0-9f0f-123456789aa2'),
      displayName: readyCatalog.sessions[0]!.title,
      strategy: 'resume' as const,
      sessionId: readyCatalog.sessions[0]!.id,
      nativeSessionId: readyCatalog.sessions[0]!.nativeId,
      reconciliationState: 'not_required' as const
    };
    setSystemInfoResult(undefined, undefined, {
      listRuntimes: vi.fn().mockResolvedValue([runtime]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      }),
      onTrayResumeSessionRequested: vi.fn((listener) => {
        requestResume = listener;
        return () => undefined;
      })
    });
    renderWithLocalization(<App />);
    await screen.findByRole('button', {
      name: `Open running terminal ${readyCatalog.sessions[0]!.title}`
    });

    act(() => requestResume(readyCatalog.sessions[0]!.id));

    expect(screen.queryByRole('dialog', { name: 'Resume session' }))
      .not.toBeInTheDocument();
    expect(await screen.findByRole('button', {
      name: `${runtime.displayName} terminal input`
    })).toHaveFocus();
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
    renderWithLocalization(<App />);

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
    fireEvent.change(within(dialog).getByRole('textbox', {
      name: 'Start prompt (optional)'
    }), {
      target: { value: 'Review the catalog implementation.' }
    });
    await waitFor(() => expect(prepareLaunch).toHaveBeenLastCalledWith({
      strategy: 'resume',
      startPrompt: 'Review the catalog implementation.',
      sessionId: session.id,
      terminalProfileId: null,
      cols: 100,
      rows: 30
    }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume session' }));

    expect(await screen.findByRole('heading', { name: session.title })).toBeInTheDocument();
    expect(document.getElementById('main-content')).toHaveClass(
      'terminal-main-content'
    );
    expect(
      screen.queryByRole('heading', { name: 'All sessions' })
    ).not.toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenLastCalledWith({
      strategy: 'resume',
      startPrompt: 'Review the catalog implementation.',
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
    renderWithLocalization(<App />);

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
      startPrompt: '',
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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
      within(dialog).getByRole('button', { name: 'Workspace' })
    ).toHaveTextContent(otherWorkspace.displayName);
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
      within(homeDialog).getByRole('button', { name: 'Workspace' })
    ).toHaveTextContent(readyCatalog.workspaces[0]!.displayName);
  });

  it('shows platform and architecture after system information resolves', async () => {
    renderWithLocalization(<App />);

    expect(screen.getByText('Reading local system')).toBeInTheDocument();
    expect(await screen.findByText('Windows · x64')).toBeInTheDocument();
    expect(screen.getByText('Lumora 0.1.0')).toBeInTheDocument();
  });

  it('shows a non-blocking diagnostic when system information fails', async () => {
    setSystemInfoResult(vi.fn().mockRejectedValue(new Error('IPC unavailable')));
    renderWithLocalization(<App />);

    expect(
      await screen.findByText('System details unavailable')
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('explains each Home dashboard area without fabricated data', async () => {
    renderWithLocalization(<App />);

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

  it('shows workspace names beside provider and token usage in Home recent sessions', async () => {
    const catalogWithUsage: CatalogSnapshot = {
      ...readyCatalog,
      sessions: [
        {
          ...readyCatalog.sessions[0]!,
          lifetimeTokens: 12_450
        }
      ]
    };
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockResolvedValue(catalogWithUsage),
      refreshCatalog: vi.fn().mockResolvedValue(catalogWithUsage)
    });
    const { unmount } = renderWithLocalization(<App />);

    const heading = await screen.findByRole('heading', {
      name: 'Recent sessions'
    });
    const card = heading.closest('article');
    const metadata = card?.querySelector('.recent-session-metadata');

    expect(card).not.toBeNull();
    expect(metadata).not.toBeNull();
    expect(within(metadata as HTMLElement).getByText('Codex')).toBeInTheDocument();
    expect(within(metadata as HTMLElement).getByText('Lumora')).toBeInTheDocument();
    expect(
      within(metadata as HTMLElement).getByText('12.5K tokens')
    ).toBeInTheDocument();

    unmount();
    const catalogWithoutWorkspace: CatalogSnapshot = {
      ...catalogWithUsage,
      workspaces: []
    };
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockResolvedValue(catalogWithoutWorkspace),
      refreshCatalog: vi.fn().mockResolvedValue(catalogWithoutWorkspace)
    });
    renderWithLocalization(<App />);

    const missingHeading = await screen.findByRole('heading', {
      name: 'Recent sessions'
    });
    const missingMetadata = missingHeading
      .closest('article')
      ?.querySelector('.recent-session-metadata');

    expect(missingMetadata).not.toBeNull();
    expect(
      within(missingMetadata as HTMLElement).queryByText('Lumora')
    ).not.toBeInTheDocument();
  });

  it('shows the real ready-provider count on Home', async () => {
    renderWithLocalization(<App />);

    expect(await screen.findByText('2 of 2 providers ready')).toBeInTheDocument();
  });

  it('opens Provider Settings from verified Home update information', async () => {
    const checkProviderUpdates = vi.fn().mockResolvedValue({
      checkedAt: '2026-08-24T01:00:00.000Z',
      providers: [{
        provider: 'codex',
        displayName: 'Codex',
        state: 'update_available',
        installedVersion: '1.2.3',
        latestVersion: '1.3.0',
        issue: null
      }]
    });
    setSystemInfoResult(undefined, undefined, { checkProviderUpdates });
    renderWithLocalization(<App />);

    fireEvent.click(await screen.findByRole('button', {
      name: '1 agent update available: Codex. Open Provider Settings'
    }));

    expect(await screen.findByRole('heading', {
      name: 'Settings'
    })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Providers' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(checkProviderUpdates).toHaveBeenCalledOnce();
  });

  it('does not check or show Home updates when automatic checks are disabled', async () => {
    const checkProviderUpdates = vi.fn();
    const getGeneralSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_GENERAL_SETTINGS,
      checkProviderUpdatesAutomatically: false
    });
    setSystemInfoResult(undefined, undefined, {
      checkProviderUpdates,
      getGeneralSettings
    });
    renderWithLocalization(<App />);

    await screen.findByText('2 of 2 providers ready');
    await waitFor(() => expect(getGeneralSettings).toHaveBeenCalledOnce());
    expect(checkProviderUpdates).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {
      name: /agent updates available/
    })).not.toBeInTheDocument();
  });

  it('checks developer prerequisites at startup without warning when ready', async () => {
    const scanDeveloperEnvironment = vi
      .fn()
      .mockResolvedValue(readyEnvironmentScan);
    setSystemInfoResult(undefined, undefined, { scanDeveloperEnvironment });

    renderWithLocalization(<App />);

    await waitFor(() => expect(scanDeveloperEnvironment).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('Node.js and npm were not found.')
    ).not.toBeInTheDocument();
  });

  it('warns about missing prerequisites without blocking the application', async () => {
    setSystemInfoResult(undefined, undefined, {
      scanDeveloperEnvironment: vi.fn().mockResolvedValue(missingNodeEnvironmentScan)
    });

    renderWithLocalization(<App />);

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

    renderWithLocalization(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Download Node.js' })
    );

    await waitFor(() => expect(openNodeDownloadPage).toHaveBeenCalledTimes(1));
  });

  it('lists detected providers, versions, and paths in Settings', async () => {
    renderWithLocalization(<App />);
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
    renderWithLocalization(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Providers' }));

    expect(await screen.findByText('codex-cli 1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Not installed')).toBeInTheDocument();
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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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

    renderWithLocalization(<App />);

    expect(await screen.findByText('1 workspace')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('Catalog implementation')).toBeInTheDocument();
    expect(getCatalog).toHaveBeenCalledWith({ text: '', provider: null });
    expect(refreshCatalog).toHaveBeenCalledWith({ text: '', provider: null });
  });

  it('does not flash hidden workspaces while visibility policies load', async () => {
    const policies = deferred<readonly [{
      workspaceId: string;
      mode: 'workspace_only';
      updatedAt: string;
    }]>();
    setSystemInfoResult(undefined, undefined, {
      getWorkspaceVisibilityPolicies: vi.fn(() => policies.promise)
    });
    renderWithLocalization(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    expect(await screen.findByText('Loading catalog')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Lumora' })).toBeNull();

    await act(async () => policies.resolve([{
      workspaceId: readyCatalog.workspaces[0]!.id,
      mode: 'workspace_only',
      updatedAt: '2026-08-12T01:00:00.000Z'
    }]));

    expect(await screen.findByRole('button', {
      name: 'Hidden workspaces (1)'
    })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Lumora' })).toBeNull();
  });

  it('uses the native workspace picker and preserves data when it is cancelled', async () => {
    const chooseWorkspace = vi.fn().mockResolvedValue(null);
    setSystemInfoResult(undefined, undefined, { chooseWorkspace });
    renderWithLocalization(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    expect(
      await screen.findByRole('heading', { name: 'Lumora' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add workspace' }));

    await waitFor(() => expect(chooseWorkspace).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: 'Lumora' })).toBeInTheDocument();
  });

  it('hides and restores a workspace without deleting provider data', async () => {
    const policy = {
      workspaceId: readyCatalog.workspaces[0]!.id,
      mode: 'workspace_only' as const,
      updatedAt: '2026-08-12T01:00:00.000Z'
    };
    const setWorkspaceVisibilityPolicy = vi.fn().mockResolvedValue([policy]);
    const restoreWorkspaceVisibility = vi.fn().mockResolvedValue([]);
    setSystemInfoResult(undefined, undefined, {
      setWorkspaceVisibilityPolicy,
      restoreWorkspaceVisibility
    });
    renderWithLocalization(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    expect(await screen.findByRole('heading', { name: 'Lumora' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Lumora' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide workspace' }));
    const hideDialog = screen.getByRole('dialog', { name: 'Hide Lumora' });
    fireEvent.click(within(hideDialog).getByRole('button', { name: 'Hide workspace' }));

    await waitFor(() => expect(setWorkspaceVisibilityPolicy).toHaveBeenCalledWith({
      workspaceId: readyCatalog.workspaces[0]!.id,
      mode: 'workspace_only'
    }));
    await waitFor(() => expect(
      screen.queryByRole('heading', { name: 'Lumora' })
    ).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Hidden workspaces (1)' }));
    const restoreDialog = screen.getByRole('dialog', { name: 'Hidden workspaces' });
    fireEvent.click(within(restoreDialog).getByRole('checkbox', { name: 'Lumora' }));
    fireEvent.click(within(restoreDialog).getByRole('button', { name: 'Restore selected' }));

    await waitFor(() => expect(restoreWorkspaceVisibility).toHaveBeenCalledWith({
      workspaceIds: [readyCatalog.workspaces[0]!.id]
    }));
    expect(await screen.findByRole('heading', { name: 'Lumora' })).toBeInTheDocument();
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
    const getCatalog = vi.fn(async () => {
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
    renderWithLocalization(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(await within(screen.getByRole('main')).findByText('Catalog implementation')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: 'hidden' }
    });
    expect(await screen.findByText('No sessions match these filters')).toBeInTheDocument();
    expect(getCatalog).toHaveBeenCalledTimes(1);

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
    expect(within(screen.getByRole('main')).getByText('Catalog implementation')).toBeInTheDocument();

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
    renderWithLocalization(<App />);

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
    renderWithLocalization(<App />);

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

  it('debounces session search and applies provider filters without catalog reads', async () => {
    const catalogWithClaude: CatalogSnapshot = {
      ...readyCatalog,
      sessions: [
        ...readyCatalog.sessions,
        {
          ...readyCatalog.sessions[0]!,
          id: 'c'.repeat(64),
          nativeId: 'claude-1',
          provider: 'claude',
          title: 'Other provider task'
        }
      ]
    };
    const getCatalog = vi.fn().mockResolvedValue(catalogWithClaude);
    setSystemInfoResult(undefined, undefined, {
      getCatalog,
      refreshCatalog: vi.fn().mockResolvedValue(catalogWithClaude)
    });
    renderWithLocalization(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(await within(screen.getByRole('main')).findByText('Catalog implementation')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: 'catalog' }
    });

    await waitFor(() => expect(screen.getByText('1 session')).toBeInTheDocument());
    expect(getCatalog).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Provider' }));
    fireEvent.click(screen.getByRole('option', { name: /Claude Code/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Provider' })).toHaveTextContent(
        'Claude Code'
      )
    );
    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No sessions match these filters')).toBeInTheDocument();
  });

  it('keeps the last good snapshot visible when background refresh fails', async () => {
    setSystemInfoResult(undefined, undefined, {
      refreshCatalog: vi.fn().mockRejectedValue(new Error('scan failed'))
    });
    renderWithLocalization(<App />);

    expect(await screen.findByText('1 workspace')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Catalog refresh failed. Last saved data is still shown.'
    );
    expect(within(screen.getByRole('main')).getByText('Catalog implementation')).toBeInTheDocument();
  });

  it('recovers from an initial catalog read failure through Try again', async () => {
    setSystemInfoResult(undefined, undefined, {
      getCatalog: vi.fn().mockRejectedValue(new Error('database unavailable')),
      refreshCatalog: vi.fn().mockResolvedValue(readyCatalog)
    });
    renderWithLocalization(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Catalog unavailable'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Lumora' })
    ).toBeInTheDocument();
  });

  it('applies the latest client-side search without stale catalog responses', async () => {
    const getCatalog = vi.fn().mockResolvedValue(readyCatalog);
    setSystemInfoResult(undefined, undefined, { getCatalog });
    renderWithLocalization(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(await within(screen.getByRole('main')).findByText('Catalog implementation')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search sessions' });
    fireEvent.change(search, { target: { value: 'first' } });
    expect(await screen.findByText('No sessions match these filters')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'second' } });
    expect(await screen.findByText('No sessions match these filters')).toBeInTheDocument();
    expect(getCatalog).toHaveBeenCalledTimes(1);
  });

  it('keeps genuine refresh activity visible while client-side search changes', async () => {
    const getCatalog = vi
      .fn()
      .mockResolvedValueOnce(readyCatalog)
      .mockResolvedValue({ ...readyCatalog, sessions: [] });
    setSystemInfoResult(undefined, undefined, {
      getCatalog,
      refreshCatalog: vi.fn(() => new Promise<CatalogSnapshot>(() => {}))
    });
    renderWithLocalization(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(await within(screen.getByRole('main')).findByText('Catalog implementation')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Refreshing catalog' })
    ).toBeDisabled();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: 'new query' }
    });
    expect(await screen.findByText('No sessions match these filters')).toBeInTheDocument();
    expect(getCatalog).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Refreshing catalog' })
    ).toBeDisabled();
  });

  it('releases startup from cached catalog data while the fresh scan continues', async () => {
    const cachedCatalog: CatalogSnapshot = {
      ...readyCatalog,
      workspaces: [],
      sessions: [],
      providerFacets: []
    };
    const refreshed = deferred<CatalogSnapshot>();
    const claimStartupPresentation = vi.fn().mockResolvedValue(true);
    const completeStartupPresentation = vi.fn().mockResolvedValue(undefined);
    setSystemInfoResult(undefined, undefined, {
      claimStartupPresentation,
      completeStartupPresentation,
      getCatalog: vi.fn().mockResolvedValue(cachedCatalog),
      refreshCatalog: vi.fn(() => refreshed.promise)
    });

    renderWithLocalization(<App />);

    await waitFor(() =>
      expect(claimStartupPresentation).toHaveBeenCalledTimes(1)
    );
    const video = await waitFor(() => {
      const element = document.querySelector('video');
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.ended(video);
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Lumora is starting' })
      ).not.toBeInTheDocument()
    );
    expect(completeStartupPresentation).toHaveBeenCalledTimes(1);
    expect(screen.getByText('0 workspaces')).toBeInTheDocument();

    await act(async () => refreshed.resolve(readyCatalog));
    expect(await within(screen.getByRole('main')).findByText('Catalog implementation')).toBeInTheDocument();
  });

  it('does not hold startup on background provider scans in StrictMode', async () => {
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
        <TestLocalizationProvider>
          <App />
        </TestLocalizationProvider>
      </StrictMode>
    );

    await waitFor(() => expect(scanProviders).toHaveBeenCalledTimes(2));
    const video = await waitFor(() => {
      const element = document.querySelector('video');
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.ended(video);

    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Lumora is starting' })
      ).not.toBeInTheDocument()
    );

    await act(async () => {
      firstScan.resolve(readyProviderScan);
      activeScan.resolve(readyProviderScan);
    });
  });
  it('keeps main navigation out of the browser Tab cycle', () => {
    renderWithLocalization(<App />);
    const home = screen.getByRole('button', { name: 'Home' });
    const sidebarToggle = screen.getByRole('button', {
      name: 'Collapse sidebar'
    });

    expect(home).toHaveAttribute('tabindex', '-1');
    expect(home).toHaveAttribute('data-lumora-command');
    expect(sidebarToggle).toHaveAttribute('tabindex', '-1');
  });
});
