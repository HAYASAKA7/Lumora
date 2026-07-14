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
  }) => (
    <div
      data-active={active}
      data-platform={platform}
      data-testid={`managed-terminal-${runtime.id}`}
    />
  )
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
        onClose={vi.fn()}
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
        onClose={vi.fn()}
        onRuntimeChange={vi.fn()}
        platform="win32"
        previews={new Map()}
        runtimes={[runtime, secondRuntime]}
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
        onClose={vi.fn()}
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
        onClose={vi.fn()}
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
        onClose={vi.fn()}
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
        onClose={vi.fn()}
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
        onClose={vi.fn()}
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
