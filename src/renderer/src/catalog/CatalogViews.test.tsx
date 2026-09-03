import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StructuredAgentRuntimeSummary } from '../../../shared/agent/contracts';
import type {
  CatalogSnapshot,
  ProviderScanResult,
  RuntimeSummary,
  TerminalProfile
} from '../../../shared/contracts';
import {
  CatalogHomeSummary,
  SessionsView,
  WorkspacesView
} from './CatalogViews';
import {
  renderWithLocalization,
  TEST_LOCALIZATION_SNAPSHOT
} from '../test/render-with-localization';

const render = renderWithLocalization;

const runningRuntime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-1234567890ff',
  displayName: 'Running session',
  strategy: 'new',
  sessionId: null,
  nativeSessionId: null,
  reconciliationState: 'unresolved',
  provider: 'codex',
  workspaceId: 'a'.repeat(64),
  terminalProfileId: 'f'.repeat(64),
  launchHash: 'e'.repeat(64),
  state: 'running',
  pid: 4242,
  createdAt: '2026-07-12T04:00:00.000Z',
  startedAt: '2026-07-12T04:00:01.000Z',
  endedAt: null,
  exitCode: null,
  errorCode: null
};

const readyStructuredRuntime: StructuredAgentRuntimeSummary = {
  connectionId: 'structured-codex',
  providerId: 'codex',
  nativeSessionId: 'native-structured-codex',
  catalogSessionId: '1'.repeat(64),
  workspaceId: 'a'.repeat(64),
  title: 'Structured review session',
  state: 'ready',
  generation: 1,
  createdAt: '2026-08-26T01:10:00.000Z',
  updatedAt: '2026-08-26T01:11:00.000Z',
  error: null
};

const catalogSnapshot: CatalogSnapshot = {
  refreshedAt: '2026-07-11T04:00:00.000Z',
  workspaces: [
    {
      id: 'a'.repeat(64),
      displayName: 'Lumora',
      canonicalPath: 'D:\\Projects\\AI\\Lumora',
      available: true,
      origin: 'manual',
      sessionCount: 2,
      providerCounts: { codex: 1, claude: 1 },
      lastActivityAt: '2026-07-11T03:45:00.000Z'
    },
    {
      id: 'b'.repeat(64),
      displayName: 'Archived docs',
      canonicalPath: 'D:\\Archive\\docs',
      available: false,
      origin: 'discovered',
      sessionCount: 1,
      providerCounts: { codex: 1, claude: 0 },
      lastActivityAt: '2026-07-10T10:00:00.000Z'
    }
  ],
  sessions: [
    {
      id: 'c'.repeat(64),
      nativeId: 'codex-1',
      provider: 'codex',
      workspaceId: 'a'.repeat(64),
      title: 'Catalog implementation',
      createdAt: '2026-07-11T03:00:00.000Z',
      updatedAt: '2026-07-11T03:45:00.000Z',
      lifetimeTokens: 12_450,
      lifecycle: 'saved',
      sourceFreshness: 'current'
    },
    {
      id: 'd'.repeat(64),
      nativeId: 'claude-1',
      provider: 'claude',
      workspaceId: 'a'.repeat(64),
      title: 'Untitled session',
      createdAt: '2026-07-11T02:00:00.000Z',
      updatedAt: '2026-07-11T03:30:00.000Z',
      lifetimeTokens: null,
      lifecycle: 'saved',
      sourceFreshness: 'current'
    },
    {
      id: 'e'.repeat(64),
      nativeId: 'codex-2',
      provider: 'codex',
      workspaceId: 'b'.repeat(64),
      title: 'Documentation cleanup',
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z',
      lifetimeTokens: null,
      lifecycle: 'saved',
      sourceFreshness: 'stale'
    }
  ],
  providerStatus: [
    {
      provider: 'codex',
      state: 'ready',
      discoveredCount: 2,
      unchangedCount: 1,
      invalidCount: 0
    },
    {
      provider: 'claude',
      state: 'ready',
      discoveredCount: 1,
      unchangedCount: 1,
      invalidCount: 0
    }
  ],
  providerFacets: [
    { provider: 'codex', sessionCount: 2 },
    { provider: 'claude', sessionCount: 1 }
  ],
  diagnostics: []
};
const providerScan: ProviderScanResult = {
  scannedAt: '2026-07-11T04:00:00.000Z',
  providers: [
    {
      provider: 'codex', displayName: 'Codex', state: 'ready',
      executablePath: 'C:\\tools\\codex.exe', version: '1.0.0', issue: null
    },
    {
      provider: 'claude', displayName: 'Claude Code', state: 'ready',
      executablePath: 'C:\\tools\\claude.exe', version: '2.0.0', issue: null
    }
  ]
};
const terminalProfile: TerminalProfile = {
  id: 'f'.repeat(64),
  kind: 'detected',
  name: 'PowerShell 7',
  shellFamily: 'pwsh',
  executablePath: 'C:\\tools\\pwsh.exe',
  args: [],
  available: true,
  recommended: true
};

const diagnosticProps = {
  dismissedDiagnosticIds: new Set<string>(),
  onDismissDiagnostic: vi.fn(),
  showInformationalNotices: true
};

function repeatedWorkspaces(count: number): CatalogSnapshot['workspaces'] {
  return Array.from({ length: count }, (_, index) => ({
    ...catalogSnapshot.workspaces[0]!,
    id: index.toString(16).padStart(64, '0'),
    displayName: `Workspace ${index + 1}`,
    canonicalPath: `D:\\Projects\\Workspace-${index + 1}`
  }));
}

function repeatedSessions(count: number): CatalogSnapshot['sessions'] {
  return Array.from({ length: count }, (_, index) => ({
    ...catalogSnapshot.sessions[0]!,
    id: (index + 100).toString(16).padStart(64, '0'),
    nativeId: `session-${index + 1}`,
    title: `Session ${index + 1}`
  }));
}

describe('WorkspacesView', () => {
  it('renders catalog-owned workspace copy from the active locale', () => {
    renderWithLocalization(
      <WorkspacesView
        isRefreshing={false}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />,
      {
        ...TEST_LOCALIZATION_SNAPSHOT,
        locale: 'zh-Hans',
        formattingLocale: 'zh-CN',
        messages: {
          ...TEST_LOCALIZATION_SNAPSHOT.messages,
          'catalog.workspaces.search-label': '搜索工作区',
          'catalog.workspaces.count': '{count, plural, other {# 个工作区}}',
          'catalog.workspaces.origin-manual': '手动添加'
        }
      }
    );

    expect(screen.getByRole('searchbox', { name: '搜索工作区' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2 个工作区' })).toBeInTheDocument();
    expect(screen.getByText('手动添加')).toBeInTheDocument();
    expect(screen.getByText('Lumora')).toBeInTheDocument();
    expect(screen.getByText('D:\\Projects\\AI\\Lumora')).toBeInTheDocument();
  });

  it('supports a read-only remote scope without local workspace controls', () => {
    const { container } = render(
      <WorkspacesView
        isRefreshing={false}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        scopeLabel="Remote provider folders"
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByText('Remote provider folders')).toBeInTheDocument();
    const search = screen.getByRole('searchbox', {
      name: 'Search workspaces'
    });
    expect(search).toBeInTheDocument();
    const toolbar = search.closest('.session-toolbar');
    const resultHeading = screen
      .getByRole('heading', { name: '2 workspaces' })
      .closest('.catalog-result-heading');
    expect(toolbar).toBeInTheDocument();
    expect(resultHeading).toBeInTheDocument();
    expect(toolbar?.nextElementSibling).toBe(resultHeading);
    expect(toolbar).toContainElement(
      screen.getByRole('button', { name: 'Refresh catalog' })
    );
    expect(screen.queryByRole('button', { name: 'Add workspace' })).not.toBeInTheDocument();
  });

  it('filters workspace names and paths case-insensitively and clears the query', () => {
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );
    const search = screen.getByRole('searchbox', {
      name: 'Search workspaces'
    });

    fireEvent.change(search, { target: { value: 'ARCHIVED' } });
    expect(
      screen.getByRole('heading', { name: 'Archived docs' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Lumora' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '1 of 2 workspaces' })
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'projects\\ai' } });
    expect(
      screen.getByRole('heading', { name: 'Lumora' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Archived docs' })
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(
      screen.getByRole('heading', { name: 'Lumora' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Archived docs' })
    ).toBeInTheDocument();
  });

  it('distinguishes filtered workspace results from an empty catalog', () => {
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search workspaces' }),
      { target: { value: 'missing workspace' } }
    );

    expect(screen.getByText('No matching workspaces')).toBeInTheDocument();
    expect(screen.queryByText('No workspaces yet')).not.toBeInTheDocument();
  });
  it('renders only nonzero counts for complete session providers', () => {
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{
          state: 'ready',
          snapshot: {
            ...catalogSnapshot,
            workspaces: [
              {
                ...catalogSnapshot.workspaces[0]!,
                sessionCount: 3,
                providerCounts: { gemini: 1, opencode: 2 }
              }
            ],
            sessions: []
          }
        }}
      />
    );

    expect(screen.getByText('Gemini CLI 1')).toBeInTheDocument();
    expect(screen.getByText('OpenCode 2')).toBeInTheDocument();
    expect(screen.queryByText('Codex 0')).not.toBeInTheDocument();
  });

  it('announces the initial catalog load', () => {
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{ state: 'loading' }}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading catalog');
  });

  it('renders workspace identity, provenance, counts, availability, and actions', () => {
    const onAddWorkspace = vi.fn();
    const onRefresh = vi.fn();
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={onAddWorkspace}
        onOpenWorkspace={vi.fn()}
        onRefresh={onRefresh}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Lumora' })).toBeInTheDocument();
    expect(screen.getByText('D:\\Projects\\AI\\Lumora')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('2 sessions')).toBeInTheDocument();
    expect(screen.getAllByText('Codex 1')).toHaveLength(2);
    expect(screen.getByText('Claude Code 1')).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Archived docs' })
    ).toBeInTheDocument();
    expect(screen.getByText('Discovered')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh catalog' }));
    expect(onAddWorkspace).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('opens the selected workspace session history from the card', () => {
    const onOpenWorkspace = vi.fn();
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={onOpenWorkspace}
        onRefresh={vi.fn()}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    const action = screen.getByRole('button', {
      name: 'Open sessions for Lumora at D:\\Projects\\AI\\Lumora'
    });
    expect(action.tagName).toBe('BUTTON');
    expect(action.closest('article')).toContainElement(
      screen.getByRole('heading', { name: 'Lumora' })
    );
    fireEvent.click(action);

    expect(onOpenWorkspace).toHaveBeenCalledWith(
      catalogSnapshot.workspaces[0]!.id
    );
    expect(screen.queryByText('View sessions')).not.toBeInTheDocument();
  });

  it('opens a workspace action menu without navigating and requests hiding', () => {
    const onHideWorkspace = vi.fn();
    const onOpenWorkspace = vi.fn();
    render(
      <WorkspacesView
        isRefreshing={false}
        onHideWorkspace={onHideWorkspace}
        onOpenWorkspace={onOpenWorkspace}
        onRefresh={vi.fn()}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for Lumora' })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide workspace' }));

    expect(onHideWorkspace).toHaveBeenCalledWith(
      catalogSnapshot.workspaces[0]
    );
    expect(onOpenWorkspace).not.toHaveBeenCalled();
  });

  it('opens the hidden-workspace manager from the toolbar', () => {
    const onManageHiddenWorkspaces = vi.fn();
    render(
      <WorkspacesView
        hiddenWorkspaceCount={2}
        isRefreshing={false}
        onManageHiddenWorkspaces={onManageHiddenWorkspaces}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Hidden workspaces (2)' })
    );
    expect(onManageHiddenWorkspaces).toHaveBeenCalledOnce();
  });

  it('keeps unavailable workspace cards natively navigable', () => {
    const onOpenWorkspace = vi.fn();
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={onOpenWorkspace}
        onRefresh={vi.fn()}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    const action = screen.getByRole('button', {
      name: 'Open sessions for Archived docs at D:\\Archive\\docs'
    });
    expect(action.tagName).toBe('BUTTON');
    fireEvent.click(action);
    expect(onOpenWorkspace).toHaveBeenCalledWith(
      catalogSnapshot.workspaces[1]!.id
    );
  });

  it('renders workspaces in batches of twenty', () => {
    const workspaces = repeatedWorkspaces(25);
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{
          state: 'ready',
          snapshot: { ...catalogSnapshot, workspaces }
        }}
      />
    );

    expect(
      screen.getAllByRole('button', { name: /Open sessions for Workspace/ })
    ).toHaveLength(20);

    fireEvent.click(
      screen.getByRole('button', { name: 'Load more workspaces' })
    );
    expect(
      screen.getAllByRole('button', { name: /Open sessions for Workspace/ })
    ).toHaveLength(25);
  });

  it('resets progressive workspace rendering when the query changes', () => {
    const workspaces = repeatedWorkspaces(45);
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{
          state: 'ready',
          snapshot: { ...catalogSnapshot, workspaces }
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Load more workspaces' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Load more workspaces' })
    );
    expect(
      screen.getAllByRole('button', { name: /Open sessions for Workspace/ })
    ).toHaveLength(45);

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search workspaces' }),
      { target: { value: 'workspace' } }
    );

    expect(
      screen.getAllByRole('button', { name: /Open sessions for Workspace/ })
    ).toHaveLength(20);
  });

  it('shows honest empty and recoverable failure states', () => {
    const { rerender } = render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
        status={{
          state: 'ready',
          snapshot: { ...catalogSnapshot, workspaces: [], sessions: [] }
        }}
      />
    );

    expect(screen.getByText('No workspaces yet')).toBeInTheDocument();

    const onRefresh = vi.fn();
    rerender(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onRefresh={onRefresh}
        status={{ state: 'error' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Catalog unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

describe('SessionsView', () => {
  it('marks a live session and offers its existing terminal', () => {
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onSearchChange={vi.fn()}
        profiles={[terminalProfile]}
        provider={null}
        providerScan={providerScan}
        queryText=""
        runningSessionIds={new Set([catalogSnapshot.sessions[0]!.id])}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Open running terminal Catalog implementation'
    })).toHaveAttribute('aria-description', 'Open running terminal');
    expect(screen.getByRole('button', {
      name: 'Resume Untitled session'
    })).toBeInTheDocument();
  });

  it('renders remote session metadata without resume actions', () => {
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onSearchChange={vi.fn()}
        profiles={[]}
        provider={null}
        providerScan={providerScan}
        queryText=""
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByText('Catalog implementation')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume Catalog implementation' })).not.toBeInTheDocument();
  });
  it('does not expose session transfer controls', () => {
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onSearchChange={vi.fn()}
        profiles={[terminalProfile]}
        provider={null}
        providerScan={providerScan}
        queryText=""
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Select sessions to export' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Catalog implementation' })
    ).not.toBeInTheDocument();
  });  it('keeps blocking catalog failures visible when informational notices are disabled', () => {
    const onRefresh = vi.fn();
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onResume={vi.fn()}
        onProviderChange={vi.fn()}
        onRefresh={onRefresh}
        onSearchChange={vi.fn()}
        provider={null}
        providerScan={providerScan}
        profiles={[terminalProfile]}
        queryText=""
        showInformationalNotices={false}
        status={{ state: 'error' }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Catalog unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows available lifetime usage and omits unavailable totals', () => {
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onResume={vi.fn()}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onSearchChange={vi.fn()}
        provider={null}
        providerScan={providerScan}
        profiles={[terminalProfile]}
        queryText=""
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByText('12.5K tokens')).toBeInTheDocument();
    expect(screen.queryByText('Unknown tokens')).not.toBeInTheDocument();
  });

  it('builds provider filters only from installed providers with sessions', () => {
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onResume={vi.fn()}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onSearchChange={vi.fn()}
        provider={null}
        providerScan={providerScan}
        profiles={[terminalProfile]}
        queryText=""
        status={{
          state: 'ready',
          snapshot: {
            ...catalogSnapshot,
            sessions: [],
            providerFacets: [
              { provider: 'gemini', sessionCount: 2 },
              { provider: 'opencode', sessionCount: 1 }
            ]
          }
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Provider' }));
    expect(
      screen.getByRole('option', { name: 'Gemini CLI (2)' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'OpenCode (1)' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Aider/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Codex/ })).toBeNull();
  });

  it('renders normalized session rows and partial provider diagnostics', () => {
    const snapshot: CatalogSnapshot = {
      ...catalogSnapshot,
      diagnostics: [
        {
          code: 'CATALOG_SOURCE_INVALID',
          provider: 'claude',
          affectedCount: 1,
          message: 'One Claude Code session source could not be normalized.',
          recovery: 'Refresh after Claude Code finishes writing.',
          retryable: true,
          scannedAt: '2026-07-11T04:00:00.000Z'
        }
      ]
    };
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onResume={vi.fn()}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onSearchChange={vi.fn()}
        provider={null}
        providerScan={providerScan}
        profiles={[terminalProfile]}
        queryText=""
        status={{ state: 'ready', snapshot }}
      />
    );

    expect(screen.getByText('3 sessions')).toBeInTheDocument();
    expect(screen.getByText('Catalog implementation')).toBeInTheDocument();
    expect(screen.getByText('Untitled session')).toBeInTheDocument();
    expect(screen.getByText('Documentation cleanup')).toBeInTheDocument();
    expect(
      screen.getAllByText('Codex', { selector: '.provider-badge' })
    ).toHaveLength(2);
    expect(
      screen.getByText('Claude Code', { selector: '.provider-badge' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Lumora')).toHaveLength(2);
    expect(screen.getByText('Archived docs')).toBeInTheDocument();
    expect(screen.getByText('Stale source')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'One Claude Code session source could not be normalized.'
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Refresh after Claude Code finishes writing.'
    );
  });

  it('dismisses one provider warning without affecting another warning', () => {
    const onDismissDiagnostic = vi.fn();
    const snapshot: CatalogSnapshot = {
      ...catalogSnapshot,
      diagnostics: [
        {
          code: 'CATALOG_SOURCE_INVALID',
          provider: 'claude',
          affectedCount: 1,
          message: 'One Claude warning.',
          recovery: 'Refresh after Claude finishes writing.',
          retryable: true,
          scannedAt: '2026-07-17T04:00:00.000Z'
        },
        {
          code: 'CATALOG_SOURCE_INVALID',
          provider: 'codex',
          affectedCount: 1,
          message: 'One Codex warning.',
          recovery: 'Refresh after Codex finishes writing.',
          retryable: true,
          scannedAt: '2026-07-17T04:00:00.000Z'
        }
      ]
    };

    render(
      <SessionsView
        dismissedDiagnosticIds={new Set()}
        isRefreshing={false}
        onDismissDiagnostic={onDismissDiagnostic}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onSearchChange={vi.fn()}
        profiles={[terminalProfile]}
        provider={null}
        providerScan={providerScan}
        queryText=""
        showInformationalNotices
        status={{ state: 'ready', snapshot }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Dismiss warning: One Claude warning.'
      })
    );

    expect(onDismissDiagnostic).toHaveBeenCalledWith(
      'CATALOG_SOURCE_INVALID:claude'
    );
    expect(screen.getByText('One Codex warning.')).toBeInTheDocument();
  });

  it('hides optional diagnostics when informational notices are disabled', () => {
    const snapshot: CatalogSnapshot = {
      ...catalogSnapshot,
      diagnostics: [
        {
          code: 'CATALOG_SOURCE_INVALID',
          provider: 'claude',
          affectedCount: 1,
          message: 'One optional Claude warning.',
          recovery: 'Refresh after Claude finishes writing.',
          retryable: true,
          scannedAt: '2026-07-17T04:00:00.000Z'
        }
      ]
    };
    const props = {
      ...diagnosticProps,
      isRefreshing: false,
      onResume: vi.fn(),
      onProviderChange: vi.fn(),
      onRefresh: vi.fn(),
      onSearchChange: vi.fn(),
      provider: null,
      providerScan,
      profiles: [terminalProfile],
      queryText: '',
      status: { state: 'ready' as const, snapshot }
    };
    const view = render(
      <SessionsView {...props} showInformationalNotices={false} />
    );

    expect(screen.queryByText('One optional Claude warning.')).toBeNull();

    view.rerender(<SessionsView {...props} showInformationalNotices />);
    expect(screen.getByText('One optional Claude warning.')).toBeInTheDocument();
  });

  it('forwards search, filter, and refresh controls and explains no matches', () => {
    const onSearchChange = vi.fn();
    const onProviderChange = vi.fn();
    const onRefresh = vi.fn();
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onResume={vi.fn()}
        onProviderChange={onProviderChange}
        onRefresh={onRefresh}
        onSearchChange={onSearchChange}
        provider="claude"
        providerScan={providerScan}
        profiles={[terminalProfile]}
        queryText="missing"
        status={{
          state: 'ready',
          snapshot: { ...catalogSnapshot, sessions: [] }
        }}
      />
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), {
      target: { value: 'catalog' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Provider' }));
    fireEvent.click(screen.getByRole('option', { name: /Codex/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh catalog' }));

    expect(onSearchChange).toHaveBeenCalledWith('catalog');
    expect(onProviderChange).toHaveBeenCalledWith('codex');
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText('No sessions match these filters')).toBeInTheDocument();
  });

  it('offers resume only for current sessions with ready launch dependencies', () => {
    const onResume = vi.fn();
    render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onResume={onResume}
        onSearchChange={vi.fn()}
        provider={null}
        providerScan={providerScan}
        profiles={[terminalProfile]}
        queryText=""
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(
      screen.queryByRole('columnheader', { name: 'Action' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();

    const currentAction = screen.getByRole('button', {
      name: 'Resume Catalog implementation'
    });
    const secondAction = screen.getByRole('button', {
      name: 'Resume Untitled session'
    });
    const staleAction = screen.getByRole('button', {
      name: 'Resume Documentation cleanup'
    });
    expect(currentAction).toBeEnabled();
    expect(currentAction).toBeEmptyDOMElement();
    expect(secondAction).toBeEnabled();
    expect(staleAction).toBeDisabled();
    expect(staleAction).toHaveAttribute('aria-description', 'Session source is stale.');

    fireEvent.click(currentAction);
    expect(onResume).toHaveBeenCalledWith(catalogSnapshot.sessions[0]);
    fireEvent.click(staleAction);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('renders sessions in batches of forty and resets for a new query', () => {
    const sessions = repeatedSessions(45);
    const sharedProps = {
      ...diagnosticProps,
      isRefreshing: false,
      onProviderChange: vi.fn(),
      onRefresh: vi.fn(),
      onResume: vi.fn(),
      onSearchChange: vi.fn(),
      provider: null,
      providerScan,
      profiles: [terminalProfile]
    };
    const { container, rerender } = render(
      <SessionsView
        {...sharedProps}
        queryText=""
        status={{
          state: 'ready',
          snapshot: { ...catalogSnapshot, sessions }
        }}
      />
    );

    expect(container.querySelectorAll('.session-row-action')).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: 'Load more sessions' }));
    expect(container.querySelectorAll('.session-row-action')).toHaveLength(45);

    rerender(
      <SessionsView
        {...sharedProps}
        queryText="new"
        status={{
          state: 'ready',
          snapshot: { ...catalogSnapshot, sessions }
        }}
      />
    );
    expect(container.querySelectorAll('.session-row-action')).toHaveLength(40);
  });

  it('explains each unavailable resume dependency', () => {
    const currentSession = catalogSnapshot.sessions[0]!;
    const unavailableWorkspaceSnapshot: CatalogSnapshot = {
      ...catalogSnapshot,
      workspaces: [
        { ...catalogSnapshot.workspaces[0]!, available: false }
      ],
      sessions: [currentSession]
    };
    const { rerender } = render(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onSearchChange={vi.fn()}
        provider={null}
        providerScan={providerScan}
        profiles={[terminalProfile]}
        queryText=""
        status={{ state: 'ready', snapshot: unavailableWorkspaceSnapshot }}
      />
    );

    expect(screen.getByRole('button', {
      name: 'Resume Catalog implementation'
    })).toHaveAttribute(
      'aria-description',
      'Workspace is unavailable.'
    );

    rerender(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onSearchChange={vi.fn()}
        provider={null}
        providerScan={{
          ...providerScan,
          providers: providerScan.providers.map((installation) =>
            installation.provider === 'codex'
              ? {
                  ...installation,
                  executablePath: null,
                  issue: {
                    code: 'PROVIDER_NOT_FOUND' as const,
                    message: 'Codex was not found on PATH.',
                    recovery: 'Install Codex or add it to PATH.',
                    retryable: true
                  },
                  state: 'not_found' as const,
                  version: null
                }
              : installation
          )
        }}
        profiles={[terminalProfile]}
        queryText=""
        status={{
          state: 'ready',
          snapshot: {
            ...catalogSnapshot,
            workspaces: [catalogSnapshot.workspaces[0]!],
            sessions: [currentSession]
          }
        }}
      />
    );

    expect(screen.getByRole('button', {
      name: 'Resume Catalog implementation'
    })).toHaveAttribute(
      'aria-description',
      'Provider is unavailable.'
    );

    rerender(
      <SessionsView
        {...diagnosticProps}
        isRefreshing={false}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onResume={vi.fn()}
        onSearchChange={vi.fn()}
        provider={null}
        providerScan={providerScan}
        profiles={[{ ...terminalProfile, available: false }]}
        queryText=""
        status={{
          state: 'ready',
          snapshot: {
            ...catalogSnapshot,
            workspaces: [catalogSnapshot.workspaces[0]!],
            sessions: [currentSession]
          }
        }}
      />
    );

    expect(screen.getByRole('button', {
      name: 'Resume Catalog implementation'
    })).toHaveAttribute(
      'aria-description',
      'No terminal profile is available.'
    );
  });
});

describe('CatalogHomeSummary', () => {
  it('links verified provider updates to Provider Settings', () => {
    const onOpenProviderUpdates = vi.fn();
    render(
      <CatalogHomeSummary
        availableProviderUpdates={['codex', 'claude']}
        onOpenProviderUpdates={onOpenProviderUpdates}
        profiles={[terminalProfile]}
        providerScan={providerScan}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    const notice = screen.getByRole('button', {
      name: '2 agent updates available: Codex, Claude Code. Open Provider Settings'
    });
    expect(notice).toHaveTextContent(
      '2 agent updates available · Codex, Claude Code'
    );
    fireEvent.click(notice);
    expect(onOpenProviderUpdates).toHaveBeenCalledOnce();
  });

  it('does not add a provider-update notice without verified updates', () => {
    render(
      <CatalogHomeSummary
        availableProviderUpdates={[]}
        onOpenProviderUpdates={vi.fn()}
        profiles={[terminalProfile]}
        providerScan={providerScan}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.queryByRole('button', {
      name: /agent updates available/
    })).not.toBeInTheDocument();
  });

  it('marks a live recent session and offers its existing terminal', () => {
    render(
      <CatalogHomeSummary
        onResume={vi.fn()}
        profiles={[terminalProfile]}
        providerScan={providerScan}
        runningSessionIds={new Set([catalogSnapshot.sessions[0]!.id])}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Open running terminal Catalog implementation'
    })).toHaveTextContent('Open');
    expect(screen.getAllByRole('button', { name: 'Resume' })).toHaveLength(2);
  });

  it('shows persisted counts, diagnostics, and recent normalized sessions', () => {
    render(
      <CatalogHomeSummary
        onResume={vi.fn()}
        profiles={[terminalProfile]}
        providerScan={providerScan}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByText('2 workspaces')).toBeInTheDocument();
    expect(screen.getByText('3 saved sessions')).toBeInTheDocument();
    expect(screen.getByText('0 catalog issues')).toBeInTheDocument();
    expect(screen.getByText('Catalog implementation')).toBeInTheDocument();
    expect(screen.getByText('12.5K tokens')).toBeInTheDocument();
    expect(screen.getByText('Untitled session')).toBeInTheDocument();
    expect(
      screen.getByText('Agents Lumora is running in a terminal or the Unified UI')
    ).toBeInTheDocument();
  });

  it('offers guarded resume actions for the three recent sessions', () => {
    const onResume = vi.fn();
    const fourthSession = {
      ...catalogSnapshot.sessions[0]!,
      id: 'g'.repeat(64),
      title: 'Older session outside the Home limit'
    };
    render(
      <CatalogHomeSummary
        onResume={onResume}
        profiles={[terminalProfile]}
        providerScan={providerScan}
        status={{
          state: 'ready',
          snapshot: {
            ...catalogSnapshot,
            sessions: [...catalogSnapshot.sessions, fourthSession]
          }
        }}
      />
    );

    const actions = screen.getAllByRole('button', { name: 'Resume' });
    expect(actions).toHaveLength(3);
    expect(actions[0]).toHaveAttribute('aria-description', 'Resume this session');
    expect(actions[0]).toBeEnabled();
    expect(actions[2]).toHaveAttribute('aria-description', 'Session source is stale.');
    expect(actions[2]).toBeDisabled();
    expect(screen.queryByText(fourthSession.title)).not.toBeInTheDocument();

    fireEvent.click(actions[0]!);
    expect(onResume).toHaveBeenCalledWith(catalogSnapshot.sessions[0]);
  });

  it('combines lost runtimes with diagnostics and offers three recent recoveries', () => {
    const diagnostic = {
      code: 'CATALOG_SOURCE_INVALID' as const,
      provider: 'claude' as const,
      affectedCount: 1,
      message: 'One source is invalid.',
      recovery: 'Refresh the catalog.',
      retryable: true,
      scannedAt: '2026-07-12T04:00:00.000Z'
    };
    const lost = Array.from({ length: 4 }, (_, index): RuntimeSummary => ({
      id: `0198f8b6-18f3-7ca0-9f0f-123456789ab${index}`,
      displayName: `Lost session ${index + 1}`,
      strategy: index === 0 ? 'resume' : 'new',
      sessionId: index === 0 ? catalogSnapshot.sessions[0]!.id : null,
      nativeSessionId: index === 0 ? catalogSnapshot.sessions[0]!.nativeId : null,
      reconciliationState: index === 0 ? 'not_required' : 'unresolved',
      provider: index % 2 === 0 ? 'codex' : 'claude',
      workspaceId: 'a'.repeat(64),
      terminalProfileId: terminalProfile.id,
      launchHash: String(index).repeat(64),
      state: 'runtime_lost',
      pid: null,
      createdAt: `2026-07-12T0${4 - index}:00:00.000Z`,
      startedAt: `2026-07-12T0${4 - index}:00:01.000Z`,
      endedAt: '2026-07-12T05:00:00.000Z',
      exitCode: null,
      errorCode: 'PTY_RUNTIME_LOST'
    }));
    const onRecover = vi.fn();

    render(
      <CatalogHomeSummary
        onRecover={onRecover}
        onResume={vi.fn()}
        profiles={[terminalProfile]}
        providerScan={providerScan}
        runtimes={lost}
        status={{
          state: 'ready',
          snapshot: { ...catalogSnapshot, diagnostics: [diagnostic] }
        }}
      />
    );

    expect(screen.getByText('5 items need attention')).toBeInTheDocument();
    expect(screen.getByText('1 catalog issue · 4 lost runtimes')).toBeInTheDocument();
    expect(screen.getByText('Resume saved session')).toBeInTheDocument();
    expect(screen.getAllByText('Restart as new session')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Recover' })).toHaveLength(3);

    fireEvent.click(screen.getAllByRole('button', { name: 'Recover' })[0]!);
    expect(onRecover).toHaveBeenCalledWith(lost[0]);
  });

  it('counts agents running in the Unified UI alongside terminal agents', () => {
    render(
      <CatalogHomeSummary
        profiles={[terminalProfile]}
        providerScan={providerScan}
        runtimes={[runningRuntime]}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
        structuredRunning={[readyStructuredRuntime]}
      />
    );

    expect(screen.getByText('2 running agents')).toBeInTheDocument();
  });

  it('reports a lone Unified UI agent instead of no managed processes', () => {
    render(
      <CatalogHomeSummary
        profiles={[terminalProfile]}
        providerScan={providerScan}
        runtimes={[]}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
        structuredRunning={[readyStructuredRuntime]}
      />
    );

    expect(screen.getByText('1 running agent')).toBeInTheDocument();
    expect(screen.queryByText('No managed processes')).not.toBeInTheDocument();
  });

  it('still reports no managed processes when nothing is running', () => {
    render(
      <CatalogHomeSummary
        profiles={[terminalProfile]}
        providerScan={providerScan}
        runtimes={[]}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
        structuredRunning={[]}
      />
    );

    expect(screen.getByText('No managed processes')).toBeInTheDocument();
  });
});
