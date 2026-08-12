import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HideWorkspaceDialog } from './HideWorkspaceDialog';

const workspace = {
  id: 'a'.repeat(64),
  displayName: 'Lumora',
  canonicalPath: 'D:\Projects\AI\Lumora',
  available: true,
  origin: 'manual' as const,
  sessionCount: 12,
  providerCounts: { codex: 12 },
  lastActivityAt: '2026-08-12T01:00:00.000Z'
};

describe('HideWorkspaceDialog', () => {
  it('uses the Lumora modal and submits the selected non-destructive mode', () => {
    const onHide = vi.fn();
    render(
      <HideWorkspaceDialog
        busy={false}
        error={null}
        onClose={vi.fn()}
        onHide={onHide}
        workspace={workspace}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'Hide Lumora' });
    expect(dialog).toHaveClass('new-session-dialog', 'workspace-visibility-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Session visibility' }));
    fireEvent.click(screen.getByRole('option', {
      name: 'Hide workspace and its sessions'
    }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hide workspace' }));

    expect(onHide).toHaveBeenCalledWith('workspace_and_sessions');
  });

  it('closes on Escape without mutating visibility', () => {
    const onClose = vi.fn();
    const onHide = vi.fn();
    render(
      <HideWorkspaceDialog
        busy={false}
        error={null}
        onClose={onClose}
        onHide={onHide}
        workspace={workspace}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onHide).not.toHaveBeenCalled();
  });
});
