import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceSummary } from '../../../shared/contracts';
import { WorkspaceTrustNotice } from './WorkspaceTrustNotice';

const workspace: WorkspaceSummary = {
  id: 'a'.repeat(64),
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\Lumora',
  available: true,
  origin: 'manual',
  sessionCount: 0,
  providerCounts: { codex: 0, claude: 0 },
  lastActivityAt: null
};

describe('WorkspaceTrustNotice', () => {
  it('explains the permission boundary and requires explicit confirmation', () => {
    const onConfirmedChange = vi.fn();
    render(
      <WorkspaceTrustNotice
        confirmed={false}
        onConfirmedChange={onConfirmedChange}
        workspace={workspace}
      />
    );

    expect(screen.getByText(workspace.displayName)).toBeInTheDocument();
    expect(screen.getByText(workspace.canonicalPath)).toBeInTheDocument();
    expect(screen.getByText(/operating-system permissions/i)).toBeInTheDocument();
    expect(screen.getByText(/not an OS sandbox/i)).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', {
      name: 'I trust this workspace and want to run the provider here'
    });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onConfirmedChange).toHaveBeenCalledWith(true);
  });
});
