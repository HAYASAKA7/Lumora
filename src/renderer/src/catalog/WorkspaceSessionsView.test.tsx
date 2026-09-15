import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  CatalogSnapshot,
  ProviderScanResult,
  TerminalProfile
} from '../../../shared/contracts';
import { WorkspaceSessionsView } from './WorkspaceSessionsView';
import { fakeChangesApi, summaryFor } from '../test/changes-test-support';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

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
      lifetimeTokens: 12_450,
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
      lifetimeTokens: null,
      lifecycle: 'saved',
      sourceFreshness: 'current'
    }
  ],
  providerStatus: [],
  providerFacets: [
    { provider: 'codex', sessionCount: 1 },
    { provider: 'claude', sessionCount: 1 }
  ],
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
  it('marks a live session and offers its existing terminal', () => {
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
        runningSessionIds={new Set([snapshot.sessions[0]!.id])}
        status={{ state: 'ready', snapshot }}
        workspaceId={workspaceId}
      />
    );

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Open running terminal Workspace drill-down'
    })).toHaveAttribute('aria-description', 'Open running terminal');
  });

  it('renders a read-only remote workspace without resume overlays', () => {
    render(
      <WorkspaceSessionsView
        isRefreshing={false}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onRetry={vi.fn()}
        operationError={null}
        profiles={[]}
        providerScan={providerScan}
        status={{ state: 'ready', snapshot }}
        workspaceId={workspaceId}
      />
    );

    expect(screen.getByText('Workspace drill-down')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume Workspace drill-down' })).not.toBeInTheDocument();
  });
  it('does not expose session transfer controls', () => {
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
        status={{ state: 'ready', snapshot }}
        workspaceId={workspaceId}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Select sessions to export' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Workspace drill-down' })
    ).not.toBeInTheDocument();
  });  it('shows only the selected workspace sessions and forwards resume', () => {
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
    expect(screen.queryByText('Claude Code 0')).not.toBeInTheDocument();
    expect(screen.getByText('Workspace drill-down')).toBeInTheDocument();
    expect(screen.getByText('12.5K tokens')).toBeInTheDocument();
    expect(screen.queryByText('Other workspace session')).not.toBeInTheDocument();

    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
    const action = screen.getByRole('button', {
      name: 'Resume Workspace drill-down'
    });
    expect(action).toBeEnabled();
    expect(action).toBeEmptyDOMElement();

    fireEvent.click(action);
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
    const action = screen.getByRole('button', {
      name: 'Resume Workspace drill-down'
    });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute(
      'aria-description',
      'Workspace is unavailable.'
    );
    fireEvent.click(action);
    expect(onResume).not.toHaveBeenCalled();
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
    expect(
      screen.queryByRole('button', { name: /^Resume / })
    ).not.toBeInTheDocument();
  });

  it('renders workspace history in batches of forty', () => {
    const sessions = Array.from({ length: 45 }, (_, index) => ({
      ...snapshot.sessions[0]!,
      id: (index + 200).toString(16).padStart(64, '0'),
      nativeId: `workspace-session-${index + 1}`,
      title: `Workspace session ${index + 1}`
    }));
    const { container } = render(
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
          snapshot: { ...snapshot, sessions }
        }}
        workspaceId={workspaceId}
      />
    );

    expect(
      container.querySelectorAll('.workspace-session-action')
    ).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }));
    expect(
      container.querySelectorAll('.workspace-session-action')
    ).toHaveLength(45);
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

  describe('changes', () => {
    const sessionId = snapshot.sessions[0]!.id;

    function changesApi() {
      const fake = fakeChangesApi((source) => summaryFor(source));
      fake.api.getChangesHistory.mockResolvedValue({
        segments: [{
          ownerId: 'owner-1',
          ownerKind: 'terminal',
          catalogSessionId: sessionId,
          createdAt: '2026-07-15T01:00:00.000Z',
          endedAt: null,
          reviews: []
        }]
      });
      return fake.api;
    }

    function view(overrides: Partial<ComponentProps<typeof WorkspaceSessionsView>> = {}) {
      return (
        <WorkspaceSessionsView
          isRefreshing={false}
          onBack={vi.fn()}
          onRefresh={vi.fn()}
          onResume={vi.fn()}
          onRetry={vi.fn()}
          operationError={null}
          profiles={[profile]}
          providerScan={providerScan}
          status={{ state: 'ready', snapshot }}
          workspaceId={workspaceId}
          {...overrides}
        />
      );
    }

    it('toggles a changes panel for the workspace from the toolbar', async () => {
      const api = changesApi();
      const { container } = render(view({ changesApi: api, changesEnabled: true }));

      const button = screen.getByRole('button', { name: 'Changes' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(button);

      const panel = screen.getByRole('complementary', { name: 'Changes' });
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(button).toHaveAttribute('aria-controls', panel.id);
      expect(panel.parentElement).toHaveClass('workspace-detail', 'has-changes-panel');
      expect(await screen.findByText('No uncommitted changes.')).toBeInTheDocument();
      expect(api.getChangesSummary).toHaveBeenCalledWith({ kind: 'workspace', workspaceId });
      expect(screen.getByRole('button', { name: 'All uncommitted' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(button);
      expect(screen.queryByRole('complementary', { name: 'Changes' })).not.toBeInTheDocument();
      expect(container.querySelector('.has-changes-panel')).toBeNull();
    });

    it('opens the history highlighting the requested session', async () => {
      const api = changesApi();
      const request = { workspaceId, mode: 'history' as const, highlightSessionId: sessionId, key: 1 };
      const { rerender } = render(view({
        changesApi: api,
        changesEnabled: true,
        changesRequest: request,
        sessionTitle: (id) => (id === sessionId ? 'Workspace drill-down' : null)
      }));

      const list = await screen.findByRole('list', { name: 'Change history' });
      const segment = within(list).getByRole('listitem');
      expect(segment).toHaveAttribute('data-highlighted', 'true');
      expect(within(segment).getByRole('heading', { name: 'Workspace drill-down' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'Close changes' }));
      expect(screen.queryByRole('complementary', { name: 'Changes' })).not.toBeInTheDocument();
      rerender(view({ changesApi: api, changesEnabled: true, changesRequest: request }));
      expect(screen.queryByRole('complementary', { name: 'Changes' })).not.toBeInTheDocument();

      rerender(view({ changesApi: api, changesEnabled: true, changesRequest: { ...request, key: 2 } }));
      expect(await screen.findByRole('list', { name: 'Change history' })).toBeInTheDocument();
    });

    it('ignores a request for another workspace', async () => {
      const api = changesApi();
      render(view({
        changesApi: api,
        changesEnabled: true,
        changesRequest: { workspaceId: otherWorkspaceId, mode: 'history', highlightSessionId: null, key: 1 }
      }));
      await act(async () => undefined);
      expect(screen.queryByRole('complementary', { name: 'Changes' })).not.toBeInTheDocument();
    });

    it('offers no changes where they are not enabled', () => {
      render(view({ changesApi: changesApi() }));
      expect(screen.queryByRole('button', { name: 'Changes' })).not.toBeInTheDocument();
    });

    it('offers View changes from a session card menu', () => {
      const onViewChanges = vi.fn();
      render(view({ onViewChanges }));
      fireEvent.contextMenu(screen.getByText('Workspace drill-down').closest('article')!);
      fireEvent.click(screen.getByRole('menuitem', { name: 'View changes' }));
      expect(onViewChanges).toHaveBeenCalledWith(snapshot.sessions[0]);
    });
  });
});
