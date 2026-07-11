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
  provider: 'codex',
  executablePath: 'C:\\tools\\codex.exe',
  args: [],
  command: 'codexp',
  workingDirectory: workspace.canonicalPath,
  environmentNames: ['PATH', 'SHELL'],
  terminalProfile: profile,
  warnings: [],
  createdAt: '2026-07-11T04:00:00.000Z',
  expiresAt: '2026-07-11T04:05:00.000Z'
};
const runtime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
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
    const startRuntime = vi.fn().mockResolvedValue(runtime);
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: { prepareLaunch, startRuntime }
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
    fireEvent.click(screen.getByRole('button', { name: 'Prepare launch' }));
    expect(await screen.findByText('C:\\tools\\codex.exe')).toBeInTheDocument();
    expect(screen.getByText('codexp')).toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      provider: 'codex',
      terminalProfileId: profile.id,
      cols: 100,
      rows: 30
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() =>
      expect(startRuntime).toHaveBeenCalledWith(preview.launchToken)
    );
    expect(onStarted).toHaveBeenCalledWith(runtime, preview);
  });
});
