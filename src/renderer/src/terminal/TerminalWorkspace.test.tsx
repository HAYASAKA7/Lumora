import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LaunchPreview,
  RuntimeSummary,
  WorkspaceSummary
} from '../../../shared/contracts';
import { TerminalWorkspace } from './TerminalWorkspace';

vi.mock('./ManagedTerminal', () => ({
  ManagedTerminal: () => <div data-testid="managed-terminal" />
}));

const sessionId = 'd'.repeat(64);
const runtime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
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
  it('hides launch details until the user opens and closes the details dialog', () => {
    render(
      <TerminalWorkspace
        activeRuntimeId={runtime.id}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onRuntimeChange={vi.fn()}
        previews={new Map([[runtime.id, preview]])}
        runtimes={[runtime]}
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
        previews={new Map()}
        runtimes={[runtime]}
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
