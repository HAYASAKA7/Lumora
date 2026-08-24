import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { HiddenWorkspaceEntry } from './catalog-visibility';
import { HiddenWorkspacesDialog } from './HiddenWorkspacesDialog';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

const entries: HiddenWorkspaceEntry[] = [
  {
    workspace: {
      id: 'a'.repeat(64), displayName: 'Lumora', canonicalPath: '/work/lumora',
      available: true, origin: 'manual', sessionCount: 2,
      providerCounts: { codex: 2 }, lastActivityAt: null
    },
    policy: {
      workspaceId: 'a'.repeat(64), mode: 'workspace_only',
      updatedAt: '2026-08-12T01:00:00.000Z'
    }
  },
  {
    workspace: {
      id: 'b'.repeat(64), displayName: 'Archive', canonicalPath: '/work/archive',
      available: false, origin: 'discovered', sessionCount: 4,
      providerCounts: { claude: 4 }, lastActivityAt: null
    },
    policy: {
      workspaceId: 'b'.repeat(64), mode: 'workspace_and_sessions',
      updatedAt: '2026-08-12T02:00:00.000Z'
    }
  }
];

describe('HiddenWorkspacesDialog', () => {
  it('searches, selects visible workspaces, and restores selected entries', () => {
    const onRestore = vi.fn();
    render(
      <HiddenWorkspacesDialog
        busy={false}
        entries={entries}
        error={null}
        onClose={vi.fn()}
        onRestore={onRestore}
        onRestoreAll={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'Hidden workspaces' });
    fireEvent.change(within(dialog).getByRole('searchbox', {
      name: 'Search hidden workspaces'
    }), { target: { value: 'archive' } });
    expect(within(dialog).queryByText('Lumora')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Archive' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore selected' }));

    expect(onRestore).toHaveBeenCalledWith(['b'.repeat(64)]);
  });

  it('supports select all and restore all without exposing hidden cards in place', () => {
    const onRestore = vi.fn();
    const onRestoreAll = vi.fn();
    render(
      <HiddenWorkspacesDialog
        busy={false}
        entries={entries}
        error={null}
        onClose={vi.fn()}
        onRestore={onRestore}
        onRestoreAll={onRestoreAll}
      />
    );

    fireEvent.change(screen.getByRole('searchbox', {
      name: 'Search hidden workspaces'
    }), { target: { value: 'archive' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all hidden' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected' }));
    expect(onRestore).toHaveBeenCalledWith(entries.map(({ workspace }) => workspace.id));
    fireEvent.click(screen.getByRole('button', { name: 'Restore all' }));
    expect(onRestoreAll).toHaveBeenCalledOnce();
  });

  it('drops selections after their workspaces are restored', () => {
    const { rerender } = render(
      <HiddenWorkspacesDialog
        busy={false}
        entries={entries}
        error={null}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRestoreAll={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lumora' }));

    rerender(
      <HiddenWorkspacesDialog
        busy={false}
        entries={entries.slice(1)}
        error={null}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onRestoreAll={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Restore selected' })).toBeDisabled();
  });
});
