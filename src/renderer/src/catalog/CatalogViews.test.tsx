import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogSnapshot } from '../../../shared/contracts';
import {
  CatalogHomeSummary,
  SessionsView,
  WorkspacesView
} from './CatalogViews';

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
  diagnostics: []
};

describe('WorkspacesView', () => {
  it('announces the initial catalog load', () => {
    render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
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
        onRefresh={onRefresh}
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Lumora' })).toBeInTheDocument();
    expect(screen.getByText('D:\\Projects\\AI\\Lumora')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('2 sessions')).toBeInTheDocument();
    expect(screen.getAllByText('Codex 1')).toHaveLength(2);
    expect(screen.getByText('Claude 1')).toBeInTheDocument();

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

  it('shows honest empty and recoverable failure states', () => {
    const { rerender } = render(
      <WorkspacesView
        isRefreshing={false}
        onAddWorkspace={vi.fn()}
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
        isRefreshing={false}
        onProviderChange={vi.fn()}
        onRefresh={vi.fn()}
        onSearchChange={vi.fn()}
        provider={null}
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

  it('forwards search, filter, and refresh controls and explains no matches', () => {
    const onSearchChange = vi.fn();
    const onProviderChange = vi.fn();
    const onRefresh = vi.fn();
    render(
      <SessionsView
        isRefreshing={false}
        onProviderChange={onProviderChange}
        onRefresh={onRefresh}
        onSearchChange={onSearchChange}
        provider="claude"
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), {
      target: { value: 'codex' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh catalog' }));

    expect(onSearchChange).toHaveBeenCalledWith('catalog');
    expect(onProviderChange).toHaveBeenCalledWith('codex');
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText('No sessions match these filters')).toBeInTheDocument();
  });
});

describe('CatalogHomeSummary', () => {
  it('shows persisted counts, diagnostics, and recent normalized sessions', () => {
    render(
      <CatalogHomeSummary
        status={{ state: 'ready', snapshot: catalogSnapshot }}
      />
    );

    expect(screen.getByText('2 workspaces')).toBeInTheDocument();
    expect(screen.getByText('3 saved sessions')).toBeInTheDocument();
    expect(screen.getByText('0 catalog issues')).toBeInTheDocument();
    expect(screen.getByText('Catalog implementation')).toBeInTheDocument();
    expect(screen.getByText('Untitled session')).toBeInTheDocument();
    expect(screen.getByText('Managed terminals arrive in the next slice')).toBeInTheDocument();
  });
});
