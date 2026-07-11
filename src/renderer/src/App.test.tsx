import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CatalogSnapshot,
  LaunchPreview,
  ProviderScanResult,
  RuntimeSummary,
  TerminalProfile
} from '../../shared/contracts';
import App from './App';

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
  diagnostics: []
};

interface CatalogApiOverrides {
  getCatalog?: ReturnType<typeof vi.fn>;
  refreshCatalog?: ReturnType<typeof vi.fn>;
  chooseWorkspace?: ReturnType<typeof vi.fn>;
  getTerminalProfiles?: ReturnType<typeof vi.fn>;
  prepareLaunch?: ReturnType<typeof vi.fn>;
  startRuntime?: ReturnType<typeof vi.fn>;
  attachRuntime?: ReturnType<typeof vi.fn>;
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
      getSystemInfo: result,
      scanProviders,
      getCatalog: catalogApi.getCatalog ?? vi.fn().mockResolvedValue(readyCatalog),
      refreshCatalog:
        catalogApi.refreshCatalog ?? vi.fn().mockResolvedValue(readyCatalog),
      chooseWorkspace:
        catalogApi.chooseWorkspace ?? vi.fn().mockResolvedValue(null),
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
      prepareLaunch: catalogApi.prepareLaunch ?? vi.fn(),
      startRuntime: catalogApi.startRuntime ?? vi.fn(),
      listRuntimes: vi.fn().mockResolvedValue([]),
      attachRuntime: catalogApi.attachRuntime ?? vi.fn(),
      writeRuntime: vi.fn().mockResolvedValue(undefined),
      resizeRuntime: vi.fn().mockResolvedValue(undefined),
      terminateRuntime: vi.fn(),
      onRuntimeEvent: vi.fn(() => () => undefined)
    }
  });
}

describe('App', () => {
  beforeEach(() => setSystemInfoResult());

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

  it('changes destination without reloading the page', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    );
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
      environmentNames: ['PATH', 'SHELL'],
      terminalProfile: profile,
      warnings: [],
      createdAt: '2026-07-11T04:00:00.000Z',
      expiresAt: '2026-07-11T04:05:00.000Z'
    };
    const runtime: RuntimeSummary = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
      strategy: 'resume',
      sessionId: session.id,
      nativeSessionId: session.nativeId,
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
      attachRuntime: vi.fn().mockResolvedValue({ runtime, snapshot: '' })
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resume session' });
    expect(within(dialog).getByText('Catalog implementation')).toBeInTheDocument();
    expect(within(dialog).getByText('Codex')).toBeInTheDocument();
    expect(within(dialog).getByText('Lumora')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare launch' }));
    expect(await within(dialog).findByText('resume codex-1')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume session' }));

    expect(await screen.findByRole('heading', { name: 'Codex terminal' })).toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'resume',
      sessionId: session.id,
      terminalProfileId: profile.id,
      cols: 100,
      rows: 30
    });
    expect(startRuntime).toHaveBeenCalledWith(preview.launchToken);
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

  it('lists detected providers, versions, and paths in Settings', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(
      screen.getByRole('heading', { name: 'Provider installations' })
    ).toBeInTheDocument();
    expect(await screen.findByText('codex-cli 1.2.3')).toBeInTheDocument();
    expect(screen.getByText('2.3.4 (Claude Code)')).toBeInTheDocument();
    expect(screen.getByText('C:\\tools\\codex.exe')).toBeInTheDocument();
    expect(screen.getByText('C:\\tools\\claude.exe')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('refreshes provider results without reloading the application', async () => {
    const scanProviders = vi
      .fn()
      .mockResolvedValueOnce(degradedProviderScan)
      .mockResolvedValueOnce(readyProviderScan);
    setSystemInfoResult(undefined, scanProviders);
    render(<App />);

    expect(await screen.findByText('1 of 2 providers ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('2.3.4 (Claude Code)')).toBeInTheDocument();
    expect(scanProviders).toHaveBeenCalledTimes(2);
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

  it('debounces session search and applies provider filters immediately', async () => {
    const getCatalog = vi
      .fn()
      .mockResolvedValueOnce(readyCatalog)
      .mockImplementation(async () => ({ ...readyCatalog, sessions: [] }));
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
});
