import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeSummary, WorkspaceSummary } from '../../../shared/contracts';
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

describe('TerminalWorkspace', () => {
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

    const inspector = screen.getByLabelText('Launch inspector');
    expect(within(inspector).getByText('Resume')).toBeInTheDocument();
    expect(
      within(inspector).getByText(sessionId.slice(0, 12))
    ).toBeInTheDocument();
  });
});
