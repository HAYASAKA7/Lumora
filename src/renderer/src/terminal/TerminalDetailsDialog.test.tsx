import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeSummary } from '../../../shared/contracts';
import { TerminalDetailsDialog } from './TerminalDetailsDialog';

const runtime: RuntimeSummary = {
  id: 'a'.repeat(64),
  provider: 'codex',
  workspaceId: 'b'.repeat(64),
  terminalProfileId: 'c'.repeat(64),
  launchHash: 'd'.repeat(64),
  state: 'running',
  pid: 1234,
  createdAt: '2026-07-24T00:00:00.000Z',
  startedAt: '2026-07-24T00:00:01.000Z',
  endedAt: null,
  exitCode: null,
  errorCode: null,
  strategy: 'fork',
  sessionId: null,
  nativeSessionId: null,
  reconciliationState: 'pending',
  displayName: 'Fork of session'
};

describe('TerminalDetailsDialog', () => {
  it('identifies a native fork as a fork launch', () => {
    render(
      <TerminalDetailsDialog
        onClose={vi.fn()}
        preview={undefined}
        runtime={runtime}
        workspace={undefined}
      />
    );

    expect(screen.getByText('Fork')).toBeInTheDocument();
  });
});
