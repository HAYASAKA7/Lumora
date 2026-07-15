import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  CatalogSnapshot,
  ProviderScanResult,
  TerminalProfile
} from '../../../shared/contracts';
import { WorkspaceSessionsView } from './WorkspaceSessionsView';

const workspaceId = 'a'.repeat(64);
const otherWorkspaceId = 'b'.repeat(64);
const snapshot: CatalogSnapshot = {
  refreshedAt: '2026-07-15T03:00:00.000Z',
  workspaces: [
    {
      id: workspaceId,
      displayName: 'Lumora',
      canonicalPath: 'D:\\Projects\\AI\\Lumora',
      available: true,
      origin: 'manual',
      sessionCount: 1,
      providerCounts: { codex: 1, claude: 0 },
      lastActivityAt: '2026-07-15T02:00:00.000Z'
    },
    {
      id: otherWorkspaceId,
      displayName: 'Other',
      canonicalPath: 'D:\\Projects\\Other',
      available: true,
      origin: 'discovered',
      sessionCount: 1,
      providerCounts: { codex: 0, claude: 1 },
      lastActivityAt: '2026-07-15T01:00:00.000Z'
    }
  ],
  sessions: [
    {
      id: 'c'.repeat(64),
      nativeId: 'codex-1',
      provider: 'codex',
      workspaceId,
      title: 'Workspace drill-down',
      createdAt: '2026-07-15T01:00:00.000Z',
      updatedAt: '2026-07-15T02:00:00.000Z',
      lifecycle: 'saved',
      sourceFreshness: 'current'
    },
    {
      id: 'd'.repeat(64),
      nativeId: 'claude-1',
      provider: 'claude',
      workspaceId: otherWorkspaceId,
      title: 'Other workspace session',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T01:00:00.000Z',
      lifecycle: 'saved',
      sourceFreshness: 'current'
    }
  ],
  providerStatus: [],
  diagnostics: []
};
const providerScan: ProviderScanResult = {
  scannedAt: '2026-07-15T03:00:00.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: 'C:\\tools\\codex.exe',
      version: '1.0.0',
      issue: null
    }
  ]
};
const profile: TerminalProfile = {
  id: 'e'.repeat(64),
  kind: 'detected',
  name: 'PowerShell 7',
  shellFamily: 'pwsh',
  executablePath: 'C:\\tools\\pwsh.exe',
  args: [],
  available: true,
  recommended: true
};

describe('WorkspaceSessionsView', () => {
  it('shows only the selected workspace sessions and forwards resume', () => {
    const onResume = vi.fn();
    render(
      <WorkspaceSessionsView
        isRefreshing={false}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onResume={onResume}
        onRetry={vi.fn()}
        operationError={null}
        profiles={[profile]}
        providerScan={providerScan}
        status={{ state: 'ready', snapshot }}
        workspaceId={workspaceId}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Lumora sessions' })
    ).toBeInTheDocument();
    expect(screen.getByText('1 session')).toBeInTheDocument();
    expect(screen.getByText('Codex 1')).toBeInTheDocument();
    expect(screen.getByText('Claude 0')).toBeInTheDocument();
    expect(screen.getByText('Workspace drill-down')).toBeInTheDocument();
    expect(screen.queryByText('Other workspace session')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledWith(snapshot.sessions[0]);
  });

  it('keeps back and retry available when detail loading fails', () => {
    const onBack = vi.fn();
    const onRetry = vi.fn();
    const { rerender } = render(
      <WorkspaceSessionsView
        isRefreshing={false}
        onBack={onBack}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onRetry={onRetry}
        operationError={null}
        profiles={[profile]}
        providerScan={providerScan}
        status={{ state: 'loading' }}
        workspaceId={workspaceId}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to workspaces' }));
    expect(onBack).toHaveBeenCalledOnce();

    rerender(
      <WorkspaceSessionsView
        isRefreshing={false}
        onBack={onBack}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onRetry={onRetry}
        operationError={null}
        profiles={[profile]}
        providerScan={providerScan}
        status={{ state: 'error' }}
        workspaceId={workspaceId}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('blocks resume when the selected workspace is unavailable', () => {
    render(
      <WorkspaceSessionsView
        isRefreshing={false}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onRetry={vi.fn()}
        operationError={null}
        profiles={[profile]}
        providerScan={providerScan}
        status={{
          state: 'ready',
          snapshot: {
            ...snapshot,
            workspaces: [
              { ...snapshot.workspaces[0]!, available: false },
              snapshot.workspaces[1]!
            ]
          }
        }}
        workspaceId={workspaceId}
      />
    );

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveAttribute(
      'title',
      'Workspace is unavailable.'
    );
  });

  it('keeps navigation available if the workspace disappeared', () => {
    const onBack = vi.fn();
    render(
      <WorkspaceSessionsView
        isRefreshing={false}
        onBack={onBack}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onRetry={vi.fn()}
        operationError={null}
        profiles={[profile]}
        providerScan={providerScan}
        status={{
          state: 'ready',
          snapshot: { ...snapshot, workspaces: [] }
        }}
        workspaceId={workspaceId}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Workspace no longer available' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to workspaces' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows an explicit empty state for a workspace without sessions', () => {
    render(
      <WorkspaceSessionsView
        isRefreshing={false}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onRetry={vi.fn()}
        operationError={null}
        profiles={[profile]}
        providerScan={providerScan}
        status={{
          state: 'ready',
          snapshot: {
            ...snapshot,
            sessions: [snapshot.sessions[1]!],
            workspaces: [
              {
                ...snapshot.workspaces[0]!,
                sessionCount: 0,
                providerCounts: { codex: 0, claude: 0 }
              },
              snapshot.workspaces[1]!
            ]
          }
        }}
        workspaceId={workspaceId}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'No sessions in this workspace' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('refreshes the complete workspace history from the detail toolbar', () => {
    const onRefresh = vi.fn();
    render(
      <WorkspaceSessionsView
        isRefreshing={false}
        onBack={vi.fn()}
        onRefresh={onRefresh}
        onResume={vi.fn()}
        onRetry={vi.fn()}
        operationError={null}
        profiles={[profile]}
        providerScan={providerScan}
        status={{ state: 'ready', snapshot }}
        workspaceId={workspaceId}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh sessions' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
