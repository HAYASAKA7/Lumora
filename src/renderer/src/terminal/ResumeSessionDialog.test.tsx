import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LaunchPreview,
  ProviderScanResult,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { ResumeSessionDialog } from './ResumeSessionDialog';

const workspace: WorkspaceSummary = {
  id: 'a'.repeat(64),
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\Lumora',
  available: true,
  origin: 'manual',
  sessionCount: 1,
  providerCounts: { codex: 1, claude: 0 },
  lastActivityAt: '2026-07-11T04:00:00.000Z'
};
const session: SessionSummary = {
  id: 'b'.repeat(64),
  nativeId: 'native-thread',
  provider: 'codex',
  workspaceId: workspace.id,
  title: 'Resume catalog work',
  createdAt: '2026-07-11T03:00:00.000Z',
  updatedAt: '2026-07-11T04:00:00.000Z',
  lifecycle: 'saved',
  sourceFreshness: 'current'
};
const profile: TerminalProfile = {
  id: 'c'.repeat(64),
  kind: 'detected',
  name: 'PowerShell 7',
  shellFamily: 'pwsh',
  executablePath: 'C:\\tools\\pwsh.exe',
  args: [],
  available: true,
  recommended: true
};
const alternateProfile: TerminalProfile = {
  ...profile,
  id: 'd'.repeat(64),
  name: 'Command Prompt',
  shellFamily: 'cmd',
  executablePath: 'C:\\Windows\\System32\\cmd.exe',
  recommended: false
};
const providerScan: ProviderScanResult = {
  scannedAt: '2026-07-11T04:00:00.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: 'C:\\tools\\codex.exe',
      version: '1.0.0',
      issue: null
    },
    {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'ready',
      executablePath: 'C:\\tools\\claude.exe',
      version: '2.0.0',
      issue: null
    }
  ]
};
const preview: LaunchPreview = {
  launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  launchHash: 'e'.repeat(64),
  strategy: 'resume',
  sessionId: session.id,
  provider: 'codex',
  executablePath: 'C:\\tools\\codex.exe',
  args: ['resume', session.nativeId],
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
  strategy: 'resume',
  sessionId: session.id,
  nativeSessionId: session.nativeId,
  provider: 'codex',
  workspaceId: workspace.id,
  terminalProfileId: profile.id,
  launchHash: preview.launchHash,
  state: 'running',
  pid: 123,
  createdAt: preview.createdAt,
  startedAt: preview.createdAt,
  endedAt: null,
  exitCode: null,
  errorCode: null
};

function renderDialog(overrides: {
  prepareLaunch?: ReturnType<typeof vi.fn>;
  startRuntime?: ReturnType<typeof vi.fn>;
} = {}) {
  const prepareLaunch = overrides.prepareLaunch ?? vi.fn().mockResolvedValue(preview);
  const startRuntime = overrides.startRuntime ?? vi.fn().mockResolvedValue(runtime);
  const onStarted = vi.fn<
    (runtime: RuntimeSummary, preview: LaunchPreview) => void
  >();
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: { prepareLaunch, startRuntime }
  });
  render(
    <ResumeSessionDialog
      onClose={vi.fn()}
      onStarted={onStarted}
      profiles={[profile, alternateProfile]}
      providerScan={providerScan}
      session={session}
      workspace={workspace}
    />
  );
  return { prepareLaunch, startRuntime, onStarted };
}

describe('ResumeSessionDialog', () => {
  it('prepares and starts the exact selected native session', async () => {
    const { prepareLaunch, startRuntime, onStarted } = renderDialog();

    expect(screen.getByText(session.title)).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText(workspace.canonicalPath)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare launch' }));
    expect(await screen.findByText('resume native-thread')).toBeInTheDocument();
    expect(screen.getByText('codexp')).toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'resume',
      sessionId: session.id,
      terminalProfileId: profile.id,
      cols: 100,
      rows: 30
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
    await waitFor(() =>
      expect(startRuntime).toHaveBeenCalledWith(preview.launchToken)
    );
    expect(onStarted).toHaveBeenCalledWith(runtime, preview);
  });

  it('invalidates the preview when the terminal profile changes', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare launch' }));
    expect(await screen.findByText('resume native-thread')).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Terminal profile' }),
      { target: { value: alternateProfile.id } }
    );

    expect(screen.queryByText('resume native-thread')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeDisabled();
  });
});
