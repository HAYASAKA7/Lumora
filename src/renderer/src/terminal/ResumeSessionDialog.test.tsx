import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  LaunchPreview,
  ProviderScanResult,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
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
  lifetimeTokens: null,
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
      winningSource: { scope: 'session', targetId: session.id },
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
  displayName: session.title,
  strategy: 'resume',
  sessionId: session.id,
  nativeSessionId: session.nativeId,
  reconciliationState: 'not_required',
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
  trustWorkspaceForLaunch?: ReturnType<typeof vi.fn>;
  startRuntime?: ReturnType<typeof vi.fn>;
  crossAgentEnabled?: boolean;
  sourceSessionActive?: boolean;
  providerScan?: ProviderScanResult | null;
} = {}) {
  const prepareLaunch = overrides.prepareLaunch ?? vi.fn().mockResolvedValue(preview);
  const trustWorkspaceForLaunch =
    overrides.trustWorkspaceForLaunch ?? vi.fn();
  const startRuntime = overrides.startRuntime ?? vi.fn().mockResolvedValue(runtime);
  const onStarted = vi.fn<
    (runtime: RuntimeSummary, preview: LaunchPreview) => void
  >();
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: { prepareLaunch, trustWorkspaceForLaunch, startRuntime }
  });
  render(
    <ResumeSessionDialog
      onClose={vi.fn()}
      onStarted={onStarted}
      generalSettings={{
        ...DEFAULT_GENERAL_SETTINGS,
        crossAgentWorkflowEnabled: overrides.crossAgentEnabled ?? false
      }}
      profiles={[profile, alternateProfile]}
      providerScan={overrides.providerScan === undefined ? providerScan : overrides.providerScan}
      session={session}
      sourceSessionActive={overrides.sourceSessionActive ?? false}
      workspace={workspace}
    />
  );
  return { prepareLaunch, trustWorkspaceForLaunch, startRuntime, onStarted };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ResumeSessionDialog', () => {
  it('prepares and starts the exact selected native session', async () => {
    const {
      prepareLaunch,
      trustWorkspaceForLaunch,
      startRuntime,
      onStarted
    } = renderDialog();

    expect(screen.getByText(session.title)).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText(workspace.canonicalPath)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Terminal profile' })).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: 'Prepare launch' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', {
      name: 'Resume with provider'
    })).not.toBeInTheDocument();

    expect(await screen.findByText('resume native-thread')).toBeInTheDocument();
    expect(screen.getByText('codexp')).toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'resume',
      sessionId: session.id,
      terminalProfileId: null,
      cols: 100,
      rows: 30
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
    await waitFor(() =>
      expect(startRuntime).toHaveBeenCalledWith(preview.launchToken)
    );
    expect(onStarted).toHaveBeenCalledWith(runtime, preview);
    expect(trustWorkspaceForLaunch).not.toHaveBeenCalled();
  });

  it('prepares promptless and prompted native forks in a stable dialog', async () => {
    const prepareLaunch = vi.fn(async (request) => {
      if (request.strategy !== 'fork') return preview;
      return {
        ...preview,
        strategy: 'fork' as const,
        sessionId: null,
        args:
          request.task === ''
            ? ['fork', session.nativeId]
            : ['fork', session.nativeId, request.task]
      };
    });
    renderDialog({
      prepareLaunch,
      sourceSessionActive: true
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('resume-session-dialog');
    expect(dialog.querySelector(
      ':scope > .dialog-body'
    )).not.toBeNull();
    fireEvent.click(screen.getByRole('radio', {
      name: 'Start a new session from this context'
    }));
    expect(screen.getByRole('textbox', {
      name: 'Initial task (optional)'
    })).toBeVisible();
    const forkButton = screen.getByRole('button', { name: 'Fork session' });
    await waitFor(() => expect(prepareLaunch).toHaveBeenLastCalledWith({
      strategy: 'fork',
      sessionId: session.id,
      task: '',
      terminalProfileId: null,
      cols: 100,
      rows: 30
    }));
    expect(await screen.findByText('fork native-thread')).toBeInTheDocument();
    expect(forkButton).toBeEnabled();
    expect(screen.getByText(
      'The source session is active. Both sessions use the same workspace, so concurrent file edits may conflict.'
    )).toBeVisible();

    const taskInput = screen.getByRole('textbox', {
      name: 'Initial task (optional)'
    });
    fireEvent.change(taskInput, {
      target: { value: 'Fix the failing tests.' }
    });
    expect(screen.queryByText(
      'The selected session is not currently available to fork.'
    )).not.toBeInTheDocument();

    await waitFor(() => expect(prepareLaunch).toHaveBeenLastCalledWith({
      strategy: 'fork',
      sessionId: session.id,
      task: 'Fix the failing tests.',
      terminalProfileId: null,
      cols: 100,
      rows: 30
    }));
    expect(await screen.findByText(
      'fork native-thread Fix the failing tests.'
    )).toBeInTheDocument();
    expect(forkButton).toBeEnabled();
  });

  it('does not offer native fork below the tested provider version', async () => {
    renderDialog({
      providerScan: {
        ...providerScan,
        providers: providerScan.providers.map((installation) =>
          installation.provider === 'codex' &&
          installation.state === 'ready'
            ? { ...installation, version: 'codex-cli 0.119.9' }
            : installation
        )
      }
    });

    expect(
      await screen.findByText('resume native-thread')
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', {
      name: 'Start a new session from this context'
    })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', {
      name: 'Task for the new session'
    })).not.toBeInTheDocument();
  });

  it('prepares a new destination session when an enabled user selects another provider', async () => {
    const crossPreview: LaunchPreview = {
      ...preview,
      strategy: 'new',
      sessionId: null,
      provider: 'claude',
      executablePath: 'C:\\tools\\claude.exe',
      args: ['Read the managed Lumora handoff context.']
    };
    const prepareLaunch = vi.fn(async (request) =>
      request.provider === 'claude' ? crossPreview : preview
    );
    renderDialog({ prepareLaunch, crossAgentEnabled: true });

    fireEvent.click(screen.getByRole('radio', {
      name: 'Start a new session from this context'
    }));
    const provider = screen.getByRole('combobox', {
      name: 'Start with provider'
    });
    expect(provider).toHaveValue('codex');
    fireEvent.change(provider, { target: { value: 'claude' } });

    expect(await screen.findByText(
      'This creates a new Claude Code session. The original Codex session remains unchanged.'
    )).toBeVisible();
    await waitFor(() => expect(prepareLaunch).toHaveBeenLastCalledWith({
      strategy: 'resume',
      sessionId: session.id,
      provider: 'claude',
      terminalProfileId: null,
      cols: 100,
      rows: 30
    }));
    expect(await screen.findByText(
      'Read the managed Lumora handoff context.'
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start handoff' })).toBeEnabled();
  });

  it('grants trust before resuming an untrusted workspace', async () => {
    const untrustedPreview = { ...preview, workspaceTrusted: false };
    const trustWorkspaceForLaunch = vi.fn().mockResolvedValue({
      workspaceId: workspace.id,
      canonicalPath: workspace.canonicalPath,
      trustedAt: preview.createdAt
    });
    const { startRuntime } = renderDialog({
      prepareLaunch: vi.fn().mockResolvedValue(untrustedPreview),
      trustWorkspaceForLaunch
    });

    const confirmation = await screen.findByRole('checkbox', {
      name: 'I trust this workspace and want to run the provider here'
    });
    expect(screen.getByText('resume native-thread')).toBeInTheDocument();
    expect(screen.getAllByText(workspace.canonicalPath).length).toBeGreaterThan(
      0
    );
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeDisabled();

    fireEvent.click(confirmation);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume session' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));

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

  it('does not resume an obsolete token when eligibility changes during trust', async () => {
    const untrustedPreview = { ...preview, workspaceTrusted: false };
    const trust = deferred<{
      workspaceId: string;
      canonicalPath: string;
      trustedAt: string;
    }>();
    const trustWorkspaceForLaunch = vi.fn().mockReturnValue(trust.promise);
    const startRuntime = vi.fn().mockResolvedValue(runtime);
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        prepareLaunch: vi.fn().mockResolvedValue(untrustedPreview),
        trustWorkspaceForLaunch,
        startRuntime
      }
    });
    const props = {
      generalSettings: DEFAULT_GENERAL_SETTINGS,
      onClose: vi.fn(),
      onStarted: vi.fn(),
      profiles: [profile, alternateProfile],
      session,
      workspace
    };
    const { rerender } = render(
      <ResumeSessionDialog {...props} providerScan={providerScan} />
    );

    fireEvent.click(await screen.findByRole('checkbox', {
      name: 'I trust this workspace and want to run the provider here'
    }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume session' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
    expect(
      screen.getByRole('combobox', { name: 'Terminal profile' })
    ).toBeDisabled();

    rerender(<ResumeSessionDialog {...props} providerScan={null} />);
    await act(async () => {
      trust.resolve({
        workspaceId: workspace.id,
        canonicalPath: workspace.canonicalPath,
        trustedAt: preview.createdAt
      });
      await trust.promise;
    });

    expect(startRuntime).not.toHaveBeenCalled();
  });

  it('invalidates the preview when the terminal profile changes', async () => {
    const pending = deferred<LaunchPreview>();
    const refreshedPreview: LaunchPreview = {
      ...preview,
      launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abe',
      terminalProfile: alternateProfile
    };
    const prepareLaunch = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockReturnValueOnce(pending.promise);
    renderDialog({ prepareLaunch });
    expect(await screen.findByText('resume native-thread')).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Terminal profile' }),
      { target: { value: alternateProfile.id } }
    );

    expect(screen.queryByText('resume native-thread')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeDisabled();
    await waitFor(() =>
      expect(prepareLaunch).toHaveBeenLastCalledWith({
        strategy: 'resume',
        sessionId: session.id,
        terminalProfileId: alternateProfile.id,
        cols: 100,
        rows: 30
      })
    );

    await act(async () => {
      pending.resolve(refreshedPreview);
      await pending.promise;
    });
    expect(await screen.findByText('resume native-thread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeEnabled();
  });

  it('uses a refreshed token after resuming fails', async () => {
    const refreshedPreview: LaunchPreview = {
      ...preview,
      launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abe'
    };
    const prepareLaunch = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce(refreshedPreview);
    const startRuntime = vi
      .fn()
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce(runtime);
    renderDialog({ prepareLaunch, startRuntime });

    await screen.findByText('resume native-thread');
    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
    expect(
      await screen.findByText('The provider session could not be resumed.')
    ).toHaveAttribute('role', 'alert');
    await waitFor(() => expect(prepareLaunch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume session' })).toBeEnabled()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
    await waitFor(() =>
      expect(startRuntime).toHaveBeenLastCalledWith(
        refreshedPreview.launchToken
      )
    );
  });
});
