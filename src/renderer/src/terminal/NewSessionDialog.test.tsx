import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LaunchPreview,
  ProviderScanResult,
  RuntimeSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { NewSessionDialog } from './NewSessionDialog';

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
const profile: TerminalProfile = {
  id: 'b'.repeat(64),
  kind: 'detected',
  name: 'PowerShell 7',
  shellFamily: 'pwsh',
  executablePath: 'C:\\tools\\pwsh.exe',
  args: [],
  available: true,
  recommended: true
};
const scan: ProviderScanResult = {
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
const preview: LaunchPreview = {
  launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  launchHash: 'c'.repeat(64),
  strategy: 'new',
  sessionId: null,
  provider: 'codex',
  executablePath: 'C:\\tools\\codex.exe',
  args: [],
  command: 'codexp',
  workingDirectory: workspace.canonicalPath,
  workspaceTrusted: true,
  environmentNames: ['PATH', 'SHELL'],
  terminalProfile: profile,
  configuration: [
    {
      field: 'providerCommand',
      value: 'codexp',
      winningSource: { scope: 'provider', targetId: 'codex' },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    },
    {
      field: 'terminalProfile',
      value: profile.id,
      winningSource: { scope: 'default', targetId: null },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    }
  ],
  warnings: [],
  createdAt: '2026-07-11T04:00:00.000Z',
  expiresAt: '2026-07-11T04:05:00.000Z'
};
const runtime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
  displayName: 'New Codex session',
  strategy: 'new',
  sessionId: null,
  nativeSessionId: null,
  reconciliationState: 'pending',
  provider: 'codex',
  workspaceId: workspace.id,
  terminalProfileId: profile.id,
  launchHash: preview.launchHash,
  state: 'running', pid: 123,
  createdAt: preview.createdAt, startedAt: preview.createdAt,
  endedAt: null, exitCode: null, errorCode: null
};

describe('NewSessionDialog', () => {
  it('requires a resolved preview before starting the exact launch token', async () => {
    const prepareLaunch = vi.fn().mockResolvedValue(preview);
    const trustWorkspaceForLaunch = vi.fn();
    const startRuntime = vi.fn().mockResolvedValue(runtime);
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: { prepareLaunch, trustWorkspaceForLaunch, startRuntime }
    });
    const onStarted = vi.fn();
    render(
      <NewSessionDialog
        onClose={vi.fn()}
        onStarted={onStarted}
        profiles={[profile]}
        providerScan={scan}
        workspaces={[workspace]}
      />
    );

    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Terminal profile' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare launch' }));
    expect(await screen.findByText('C:\\tools\\codex.exe')).toBeInTheDocument();
    expect(screen.getByText('codexp')).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', {
        name: 'I trust this workspace and want to run the provider here'
      })
    ).not.toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'new',
      workspaceId: workspace.id,
      provider: 'codex',
      terminalProfileId: null,
      cols: 100,
      rows: 30
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() =>
      expect(startRuntime).toHaveBeenCalledWith(preview.launchToken)
    );
    expect(onStarted).toHaveBeenCalledWith(runtime, preview);
    expect(trustWorkspaceForLaunch).not.toHaveBeenCalled();
  });

  it('grants explicit trust before starting an untrusted workspace', async () => {
    const untrustedPreview = { ...preview, workspaceTrusted: false };
    const prepareLaunch = vi.fn().mockResolvedValue(untrustedPreview);
    const trustWorkspaceForLaunch = vi.fn().mockResolvedValue({
      workspaceId: workspace.id,
      canonicalPath: workspace.canonicalPath,
      trustedAt: preview.createdAt
    });
    const startRuntime = vi.fn().mockResolvedValue(runtime);
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: { prepareLaunch, trustWorkspaceForLaunch, startRuntime }
    });
    render(
      <NewSessionDialog
        onClose={vi.fn()}
        onStarted={vi.fn()}
        profiles={[profile]}
        providerScan={scan}
        workspaces={[workspace]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Prepare launch' }));
    const confirmation = await screen.findByRole('checkbox', {
      name: 'I trust this workspace and want to run the provider here'
    });
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();

    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() =>
      expect(trustWorkspaceForLaunch).toHaveBeenCalledWith(
        untrustedPreview.launchToken
      )
    );
    await waitFor(() =>
      expect(startRuntime).toHaveBeenCalledWith(untrustedPreview.launchToken)
    );
    expect(trustWorkspaceForLaunch.mock.invocationCallOrder[0]).toBeLessThan(
      startRuntime.mock.invocationCallOrder[0]!
    );
  });

  it('keeps the dialog open when workspace trust cannot be saved', async () => {
    const untrustedPreview = { ...preview, workspaceTrusted: false };
    const trustWorkspaceForLaunch = vi.fn().mockRejectedValue(new Error('disk'));
    const startRuntime = vi.fn();
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        prepareLaunch: vi.fn().mockResolvedValue(untrustedPreview),
        trustWorkspaceForLaunch,
        startRuntime
      }
    });
    render(
      <NewSessionDialog
        onClose={vi.fn()}
        onStarted={vi.fn()}
        profiles={[profile]}
        providerScan={scan}
        workspaces={[workspace]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Prepare launch' }));
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: 'I trust this workspace and want to run the provider here'
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(
      await screen.findByText('Workspace trust could not be saved.')
    ).toHaveAttribute('role', 'alert');
    expect(startRuntime).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeInTheDocument();
  });
});
