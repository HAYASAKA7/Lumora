import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LaunchPreview,
  RuntimeSummary,
  SystemInfo,
  WorkspaceSummary
} from '../../../shared/contracts';
import { TerminalWorkspace } from './TerminalWorkspace';

vi.mock('./ManagedTerminal', () => ({
  ManagedTerminal: ({
    active,
    platform,
    runtime
  }: {
    active: boolean;
    platform: SystemInfo['platform'];
    runtime: RuntimeSummary;
  }) => {
    if (runtime.displayName === 'Broken terminal') {
      throw new Error('private terminal render detail');
    }
    return (
      <div
        data-active={active}
        data-platform={platform}
        data-testid={`managed-terminal-${runtime.id}`}
      />
    );
  }
}));

const sessionId = 'd'.repeat(64);
const runtime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  displayName: 'Repository cleanup',
  strategy: 'resume',
  sessionId,
  nativeSessionId: 'native-thread-1',
  reconciliationState: 'not_required',
  provider: 'codex',
  workspaceId: 'a'.repeat(64),
  terminalProfileId: 'b'.repeat(64),
  launchHash: 'c'.repeat(64),
  state: 'completed',
  pid: null,
  createdAt: '2026-07-11T04:00:00.000Z',
  startedAt: '2026-07-11T04:00:01.000Z',
  endedAt: '2026-07-11T04:05:00.000Z',
  exitCode: 0,
  errorCode: null
};
const workspace: WorkspaceSummary = {
  id: runtime.workspaceId,
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\AI\\Lumora',
  available: true,
  origin: 'manual',
  sessionCount: 1,
  providerCounts: { codex: 1, claude: 0 },
  lastActivityAt: '2026-07-11T04:00:00.000Z'
};
const preview: LaunchPreview = {
  launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
  launchHash: runtime.launchHash,
  strategy: 'resume',
  sessionId,
  provider: 'codex',
  executablePath: 'C:\\tools\\codex.exe',
  args: ['resume', 'native-thread-1'],
  command: 'workspace-codex',
  workingDirectory: workspace.canonicalPath,
  workspaceTrusted: true,
  environmentNames: ['PATH'],
  terminalProfile: {
    id: runtime.terminalProfileId,
    kind: 'detected',
    name: 'PowerShell 7',
    shellFamily: 'pwsh',
    executablePath: 'C:\\tools\\pwsh.exe',
    args: [],
    available: true,
    recommended: true
  },
  configuration: [
    {
      field: 'providerCommand',
      value: 'workspace-codex',
      winningSource: { scope: 'workspace', targetId: workspace.id },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    },
    {
      field: 'terminalProfile',
      value: runtime.terminalProfileId,
      winningSource: { scope: 'global', targetId: null },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    }
  ],
  warnings: [],
  createdAt: runtime.createdAt,
  expiresAt: '2026-07-11T04:05:00.000Z'
};

describe('TerminalWorkspace', () => {
  it('contains one terminal render failure without removing other tabs', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const brokenRuntime: RuntimeSummary = {
      ...runtime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abe',
      displayName: 'Broken terminal'
    };

    render(
      <TerminalWorkspace
        activeRuntimeId={brokenRuntime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[runtime, brokenRuntime]}
        visible
        workspaces={[workspace]}
      />
    );

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(
      screen.getByRole('alert', { name: 'Terminal view unavailable' })
    ).toBeVisible();
    expect(screen.getByTestId(`managed-terminal-${runtime.id}`))
      .toBeInTheDocument();
    expect(screen.queryByText('private terminal render detail'))
      .not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('reorders a tab after a pointer drag without activating it', () => {
    const secondRuntime: RuntimeSummary = {
      ...runtime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
      displayName: 'Release notes'
    };
    const onActivate = vi.fn();
    const onReorder = vi.fn();

    render(
      <TerminalWorkspace
        activeRuntimeId={runtime.id}
        onActivate={onActivate}
        onReorder={onReorder}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[runtime, secondRuntime]}
        visible
        workspaces={[workspace]}
      />
    );

    const tabs = screen.getAllByRole('tab');
    vi.spyOn(tabs[0]!, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 100,
      width: 100
    } as DOMRect);
    vi.spyOn(tabs[1]!, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 200,
      width: 100
    } as DOMRect);

    fireEvent.pointerDown(tabs[0]!, {
      button: 0,
      clientX: 50,
      pointerId: 1
    });
    fireEvent.pointerMove(screen.getByRole('tablist'), {
      clientX: 175,
      pointerId: 1
    });
    fireEvent.pointerUp(screen.getByRole('tablist'), {
      clientX: 175,
      pointerId: 1
    });
    fireEvent.click(tabs[0]!);

    expect(onReorder).toHaveBeenCalledWith(runtime.id, 1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('moves a focused tab with Alt+Shift+Arrow keys and ignores boundaries', () => {
    const secondRuntime: RuntimeSummary = {
      ...runtime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
      displayName: 'Release notes'
    };
    const onReorder = vi.fn();

    render(
      <TerminalWorkspace
        activeRuntimeId={runtime.id}
        onActivate={vi.fn()}
        onReorder={onReorder}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[runtime, secondRuntime]}
        visible
        workspaces={[workspace]}
      />
    );

    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[0]!, {
      altKey: true,
      code: 'ArrowRight',
      key: 'ArrowRight',
      shiftKey: true
    });
    fireEvent.keyDown(tabs[0]!, {
      altKey: true,
      code: 'ArrowLeft',
      key: 'ArrowLeft',
      shiftKey: true
    });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(runtime.id, 1);
    expect(
      screen.getByText('Repository cleanup moved to position 2 of 2.')
    ).toBeInTheDocument();
  });

  it('offers Stop without a manual tab close action for a live runtime', () => {
    const liveRuntime: RuntimeSummary = {
      ...runtime,
      state: 'running',
      pid: 4321,
      endedAt: null,
      exitCode: null
    };

    render(
      <TerminalWorkspace
        activeRuntimeId={liveRuntime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[liveRuntime]}
        visible
        workspaces={[workspace]}
      />
    );

    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Close tab' })
    ).not.toBeInTheDocument();
  });

  it('keeps the stopping state attached to the runtime being stopped', () => {
    const firstRuntime: RuntimeSummary = {
      ...runtime,
      state: 'running',
      pid: 4321,
      endedAt: null,
      exitCode: null
    };
    const secondRuntime: RuntimeSummary = {
      ...firstRuntime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
      displayName: 'Second active terminal',
      pid: 4322
    };
    const terminateRuntime = vi.fn(
      () => new Promise<RuntimeSummary>(() => undefined)
    );
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: { terminateRuntime }
    });
    const onRuntimeChange = vi.fn();
    const { rerender } = render(
      <TerminalWorkspace
        activeRuntimeId={firstRuntime.id}
        onActivate={vi.fn()}
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        previews={new Map()}
        runtimes={[firstRuntime, secondRuntime]}
        visible
        workspaces={[workspace]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('button', { name: 'Stopping' })).toBeDisabled();
    expect(terminateRuntime).toHaveBeenCalledWith(firstRuntime.id);

    rerender(
      <TerminalWorkspace
        activeRuntimeId={secondRuntime.id}
        onActivate={vi.fn()}
        onRuntimeChange={onRuntimeChange}
        platform="win32"
        previews={new Map()}
        runtimes={[firstRuntime, secondRuntime]}
        visible
        workspaces={[workspace]}
      />
    );

    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Stopping' })
    ).not.toBeInTheDocument();
  });

  it('keeps one mounted terminal for every open tab while switching', () => {
    const secondRuntime: RuntimeSummary = {
      ...runtime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
      displayName: 'Release notes',
      provider: 'claude',
      state: 'running',
      pid: 4321,
      endedAt: null,
      exitCode: null
    };
    const { rerender } = render(
      <TerminalWorkspace
        activeRuntimeId={runtime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[runtime, secondRuntime]}
        visible
        workspaces={[workspace]}
      />
    );
    const firstTerminal = screen.getByTestId(`managed-terminal-${runtime.id}`);
    const secondTerminal = screen.getByTestId(
      `managed-terminal-${secondRuntime.id}`
    );

    expect(firstTerminal.parentElement).not.toHaveAttribute('hidden');
    expect(secondTerminal.parentElement).toHaveAttribute('hidden');
    expect(firstTerminal).toHaveAttribute('data-active', 'true');
    expect(secondTerminal).toHaveAttribute('data-active', 'false');
    expect(firstTerminal).toHaveAttribute('data-platform', 'win32');
    expect(secondTerminal).toHaveAttribute('data-platform', 'win32');

    rerender(
      <TerminalWorkspace
        activeRuntimeId={secondRuntime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[secondRuntime, runtime]}
        visible
        workspaces={[workspace]}
      />
    );

    expect(screen.getByTestId(`managed-terminal-${runtime.id}`)).toBe(
      firstTerminal
    );
    expect(
      screen.getByTestId(`managed-terminal-${secondRuntime.id}`)
    ).toBe(secondTerminal);
    expect(firstTerminal.parentElement).toHaveAttribute('hidden');
    expect(secondTerminal.parentElement).not.toHaveAttribute('hidden');
    expect(firstTerminal).toHaveAttribute('data-active', 'false');
    expect(secondTerminal).toHaveAttribute('data-active', 'true');

    rerender(
      <TerminalWorkspace
        activeRuntimeId={secondRuntime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[runtime, secondRuntime]}
        visible={false}
        workspaces={[workspace]}
      />
    );
    expect(firstTerminal).toHaveAttribute('data-active', 'false');
    expect(secondTerminal).toHaveAttribute('data-active', 'false');
  });

  it('uses the durable session name as the primary tab and heading label', () => {
    render(
      <TerminalWorkspace
        activeRuntimeId={runtime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[runtime]}
        visible
        workspaces={[workspace]}
      />
    );

    const tab = screen.getByRole('tab', { name: /Repository cleanup/ });
    expect(within(tab).getByText('Repository cleanup')).toBeInTheDocument();
    expect(within(tab).getByText('Codex · completed')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Repository cleanup' })
    ).toBeInTheDocument();
  });

  it('hides launch details until the user opens and closes the details dialog', () => {
    render(
      <TerminalWorkspace
        activeRuntimeId={runtime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map([[runtime.id, preview]])}
        runtimes={[runtime]}
        visible
        workspaces={[workspace]}
      />
    );

    expect(
      screen.queryByRole('dialog', { name: 'Terminal details' })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Launch inspector')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Terminal details' }));
    const dialog = screen.getByRole('dialog', { name: 'Terminal details' });
    const inspector = within(dialog).getByLabelText('Launch inspector');
    expect(within(inspector).getByText('Workspace layer')).toBeInTheDocument();
    expect(within(inspector).getByText('Global layer')).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close terminal details' })
    );
    expect(
      screen.queryByRole('dialog', { name: 'Terminal details' })
    ).not.toBeInTheDocument();
  });

  it('shows durable resume identity without an ephemeral preview', () => {
    render(
      <TerminalWorkspace
        activeRuntimeId={runtime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[runtime]}
        visible
        workspaces={[workspace]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Terminal details' }));
    const inspector = within(
      screen.getByRole('dialog', { name: 'Terminal details' })
    ).getByLabelText('Launch inspector');
    expect(within(inspector).getByText('Resume')).toBeInTheDocument();
    expect(
      within(inspector).getByText(sessionId.slice(0, 12))
    ).toBeInTheDocument();
    expect(within(inspector).getByText('Native resume')).toBeInTheDocument();
  });

  it.each([
    ['pending', 'Matching provider session'],
    ['linked', 'Linked'],
    ['ambiguous', 'Ambiguous — not linked'],
    ['unresolved', 'Not found — unlinked']
  ] as const)('shows %s new-session identity state', (state, label) => {
    const linked = state === 'linked';
    render(
      <TerminalWorkspace
        activeRuntimeId={runtime.id}
        onActivate={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[
          {
            ...runtime,
            strategy: 'new',
            reconciliationState: state,
            sessionId: linked ? sessionId : null,
            nativeSessionId: linked ? 'native-thread-1' : null
          }
        ]}
        visible
        workspaces={[workspace]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Terminal details' }));
    const inspector = within(
      screen.getByRole('dialog', { name: 'Terminal details' })
    ).getByLabelText('Launch inspector');
    expect(within(inspector).getByText(label)).toBeInTheDocument();
  });
});
