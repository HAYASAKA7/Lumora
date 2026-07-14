import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

import lumoraBrandMarkUrl from '../../../resources/icons/lumora/source/lumora-symbol-gradient.svg';
import { DEFAULT_KEYBOARD_SETTINGS } from '../../shared/contracts';
import type {
  CatalogSnapshot,
  LaunchPreview,
  ProviderScanResult,
  RuntimeEvent,
  RuntimeSummary,
  SystemInfo,
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

vi.mock('./terminal/ManagedTerminal', () => ({
  ManagedTerminal: ({
    platform,
    runtime,
    onRuntimeChange
  }: {
    platform: SystemInfo['platform'];
    runtime: RuntimeSummary;
    onRuntimeChange(runtime: RuntimeSummary): void;
  }) => {
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
    return (
      <div className="managed-terminal-shell" data-platform={platform}>
        <button
          aria-label={`${runtime.displayName} terminal input`}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.code === 'KeyV') {
              void window.lumora.readClipboardText();
            }
          }}
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
  getCatalog?: ReturnType<typeof vi.fn>;
  refreshCatalog?: ReturnType<typeof vi.fn>;
  chooseWorkspace?: ReturnType<typeof vi.fn>;
  getTerminalProfiles?: ReturnType<typeof vi.fn>;
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
      getSystemInfo: result,
      scanProviders,
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

    const brand = screen
      .getByText('Agent workspace manager')
      .closest('.brand');
    const mark = brand?.querySelector<HTMLImageElement>('img.brand-mark');

    expect(brand?.querySelector('strong')).toHaveTextContent('Lumora');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('alt', '');
    expect(mark).toHaveAttribute('src', lumoraBrandMarkUrl);
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
      version: 1,
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
      version: 1,
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
    expect(
      await screen.findByRole('heading', { name: 'Launch defaults' })
    ).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resume session' });
    expect(within(dialog).getByText('Catalog implementation')).toBeInTheDocument();
    expect(within(dialog).getByText('Codex')).toBeInTheDocument();
    expect(within(dialog).getByText('Lumora')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare launch' }));
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
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Prepare recovery' })
    );
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
    expect(
      await screen.findByRole('heading', { name: 'Workspace trust' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Keyboard shortcuts' })
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
