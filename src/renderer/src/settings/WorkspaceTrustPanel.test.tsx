import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  GeneralSettings,
  WorkspaceSummary,
  WorkspaceTrustDecision
} from '../../../shared/contracts';
import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import { WorkspaceTrustPanel } from './WorkspaceTrustPanel';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

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

function renderPanel({
  settings = DEFAULT_GENERAL_SETTINGS,
  saving = false,
  onSettingsChange = vi.fn()
}: {
  settings?: GeneralSettings;
  saving?: boolean;
  onSettingsChange?: (settings: GeneralSettings) => void;
} = {}) {
  return {
    onSettingsChange,
    ...render(
      <WorkspaceTrustPanel
        onSettingsChange={onSettingsChange}
        saving={saving}
        settings={settings}
        workspaces={[workspace]}
      />
    )
  };
}

describe('WorkspaceTrustPanel', () => {
  it('loads named decisions and revokes by stable workspace ID', async () => {
    const { get, revoke } = installApi();
    renderPanel();

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
    renderPanel();

    expect(await screen.findByText('No workspaces are trusted.')).toBeInTheDocument();
  });

  it('isolates load failures in an inline alert', async () => {
    installApi({ get: vi.fn().mockRejectedValue(new Error('database')) });
    renderPanel();

    expect(
      await screen.findByText('Workspace trust decisions could not be loaded.')
    ).toHaveAttribute('role', 'alert');
  });

  it('keeps the decision visible when revocation fails', async () => {
    installApi({ revoke: vi.fn().mockRejectedValue(new Error('database')) });
    renderPanel();

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

  it('requires an explicit acknowledgement before enabling auto-trust', async () => {
    installApi();
    const onSettingsChange = vi.fn();
    renderPanel({ onSettingsChange });

    fireEvent.click(screen.getByRole('switch', {
      name: 'Automatically trust workspaces when launching'
    }));
    const confirm = screen.getByRole('button', { name: 'Enable auto-trust' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'I understand that agents can change or delete workspace files'
    }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      autoTrustWorkspaces: true
    });
  });

  it('disables auto-trust immediately without revoking existing decisions', () => {
    installApi();
    const onSettingsChange = vi.fn();
    renderPanel({
      onSettingsChange,
      settings: { ...DEFAULT_GENERAL_SETTINGS, autoTrustWorkspaces: true }
    });

    fireEvent.click(screen.getByRole('switch', {
      name: 'Automatically trust workspaces when launching'
    }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      autoTrustWorkspaces: false
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
