import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceSummary,
  WorkspaceTrustDecision
} from '../../../shared/contracts';
import { WorkspaceTrustPanel } from './WorkspaceTrustPanel';

const workspace: WorkspaceSummary = {
  id: 'a'.repeat(64),
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\Lumora',
  available: true,
  origin: 'manual',
  sessionCount: 1,
  providerCounts: { codex: 1, claude: 0 },
  lastActivityAt: '2026-07-13T08:00:00.000Z'
};
const decision: WorkspaceTrustDecision = {
  workspaceId: workspace.id,
  canonicalPath: workspace.canonicalPath,
  trustedAt: '2026-07-13T08:00:00.000Z'
};

function installApi({
  get = vi.fn().mockResolvedValue([decision]),
  revoke = vi.fn().mockResolvedValue([])
}: {
  get?: ReturnType<typeof vi.fn>;
  revoke?: ReturnType<typeof vi.fn>;
} = {}) {
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: {
      getWorkspaceTrustDecisions: get,
      revokeWorkspaceTrust: revoke
    }
  });
  return { get, revoke };
}

describe('WorkspaceTrustPanel', () => {
  it('loads named decisions and revokes by stable workspace ID', async () => {
    const { get, revoke } = installApi();
    render(<WorkspaceTrustPanel workspaces={[workspace]} />);

    expect(await screen.findByText(workspace.displayName)).toBeInTheDocument();
    expect(screen.getByText(decision.canonicalPath)).toBeInTheDocument();
    expect(screen.getByText(/not an OS sandbox/i)).toBeInTheDocument();
    expect(get).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole('button', { name: `Revoke trust for ${workspace.displayName}` })
    );
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith(decision.workspaceId)
    );
    expect(await screen.findByText('No workspaces are trusted.')).toBeInTheDocument();
  });

  it('shows an empty state when no trust decisions exist', async () => {
    installApi({ get: vi.fn().mockResolvedValue([]) });
    render(<WorkspaceTrustPanel workspaces={[workspace]} />);

    expect(await screen.findByText('No workspaces are trusted.')).toBeInTheDocument();
  });

  it('isolates load failures in an inline alert', async () => {
    installApi({ get: vi.fn().mockRejectedValue(new Error('database')) });
    render(<WorkspaceTrustPanel workspaces={[workspace]} />);

    expect(
      await screen.findByText('Workspace trust decisions could not be loaded.')
    ).toHaveAttribute('role', 'alert');
  });

  it('keeps the decision visible when revocation fails', async () => {
    installApi({ revoke: vi.fn().mockRejectedValue(new Error('database')) });
    render(<WorkspaceTrustPanel workspaces={[workspace]} />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Revoke trust for ${workspace.displayName}`
      })
    );
    expect(
      await screen.findByText('Workspace trust could not be revoked.')
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByText(decision.canonicalPath)).toBeInTheDocument();
  });
});
