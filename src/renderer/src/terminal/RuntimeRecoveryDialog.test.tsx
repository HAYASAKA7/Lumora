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
import { RuntimeRecoveryDialog } from './RuntimeRecoveryDialog';

const workspace: WorkspaceSummary = {
  id: 'a'.repeat(64),
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\Lumora',
  available: true,
  origin: 'manual',
  sessionCount: 1,
  providerCounts: { codex: 1, claude: 0 },
  lastActivityAt: '2026-07-12T04:00:00.000Z'
};
const session: SessionSummary = {
  id: 'b'.repeat(64),
  nativeId: 'native-thread',
  provider: 'codex',
  workspaceId: workspace.id,
  title: 'Interrupted work',
  createdAt: '2026-07-12T03:00:00.000Z',
  updatedAt: '2026-07-12T04:00:00.000Z',
  lifetimeTokens: null,
  lifecycle: 'saved',
  sourceFreshness: 'current'
};
const recommendedProfile: TerminalProfile = {
  id: 'c'.repeat(64),
  kind: 'detected',
  name: 'PowerShell 7',
  shellFamily: 'pwsh',
  executablePath: 'C:\\tools\\pwsh.exe',
  args: [],
  available: true,
  recommended: true
};
const previousProfile: TerminalProfile = {
  ...recommendedProfile,
  id: 'd'.repeat(64),
  name: 'Command Prompt',
  shellFamily: 'cmd',
  executablePath: 'C:\\Windows\\System32\\cmd.exe',
  recommended: false
};
const providerScan: ProviderScanResult = {
  scannedAt: '2026-07-12T04:00:00.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: 'C:\\tools\\codex.exe',
      version: '1.0.0',
      issue: null
    }
  ]
};
const lostRuntime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  displayName: session.title,
  strategy: 'resume',
  sessionId: session.id,
  nativeSessionId: session.nativeId,
  reconciliationState: 'not_required',
  provider: 'codex',
  workspaceId: workspace.id,
  terminalProfileId: previousProfile.id,
  launchHash: 'e'.repeat(64),
  state: 'runtime_lost',
  pid: null,
  createdAt: '2026-07-12T03:00:00.000Z',
  startedAt: '2026-07-12T03:00:01.000Z',
  endedAt: '2026-07-12T04:00:00.000Z',
  exitCode: null,
  errorCode: 'PTY_RUNTIME_LOST'
};
const preview: LaunchPreview = {
  launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
  launchHash: 'f'.repeat(64),
  strategy: 'resume',
  sessionId: session.id,
  provider: 'codex',
  executablePath: 'C:\\tools\\codex.exe',
  args: ['resume', session.nativeId],
  command: 'codexp',
  workingDirectory: workspace.canonicalPath,
  workspaceTrusted: true,
  environmentNames: ['PATH'],
  terminalProfile: previousProfile,
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
      value: previousProfile.id,
      winningSource: { scope: 'session', targetId: session.id },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    }
  ],
  warnings: [],
  createdAt: '2026-07-12T04:01:00.000Z',
  expiresAt: '2026-07-12T04:06:00.000Z'
};
const startedRuntime: RuntimeSummary = {
  ...lostRuntime,
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abe',
  state: 'running',
  pid: 321,
  createdAt: preview.createdAt,
  startedAt: preview.createdAt,
  endedAt: null,
  errorCode: null,
  launchHash: preview.launchHash
};

interface RenderOptions {
  runtime?: RuntimeSummary;
  sessions?: readonly SessionSummary[];
  workspaces?: readonly WorkspaceSummary[];
  profiles?: readonly TerminalProfile[];
  providerScan?: ProviderScanResult | null;
  prepareLaunch?: ReturnType<typeof vi.fn>;
  trustWorkspaceForLaunch?: ReturnType<typeof vi.fn>;
  startRuntime?: ReturnType<typeof vi.fn>;
}

function renderDialog(options: RenderOptions = {}) {
  const prepareLaunch =
    options.prepareLaunch ?? vi.fn().mockResolvedValue(preview);
  const trustWorkspaceForLaunch =
    options.trustWorkspaceForLaunch ?? vi.fn();
  const startRuntime =
    options.startRuntime ?? vi.fn().mockResolvedValue(startedRuntime);
  const onStarted = vi.fn<
    (runtime: RuntimeSummary, launchPreview: LaunchPreview) => void
  >();
  Object.defineProperty(window, 'lumora', {
    configurable: true,
    value: { prepareLaunch, trustWorkspaceForLaunch, startRuntime }
  });
  const rendered = render(
    <RuntimeRecoveryDialog
      onClose={vi.fn()}
      onStarted={onStarted}
      profiles={options.profiles ?? [recommendedProfile, previousProfile]}
      providerScan={
        options.providerScan === undefined ? providerScan : options.providerScan
      }
      runtime={options.runtime ?? lostRuntime}
      sessions={options.sessions ?? [session]}
      workspaces={options.workspaces ?? [workspace]}
    />
  );
  return {
    prepareLaunch,
    trustWorkspaceForLaunch,
    startRuntime,
    onStarted,
    ...rendered
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('RuntimeRecoveryDialog', () => {
  it('previews and starts an exact native resume with configured defaults', async () => {
    const { prepareLaunch, startRuntime, onStarted } = renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Recover lost runtime' });
    expect(dialog).toHaveClass('runtime-recovery-dialog');
    expect(dialog.querySelector(
      ':scope > .dialog-body'
    )).not.toBeNull();
    expect(
      screen.getByRole('region', { name: 'Launch readiness' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Resume saved session')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Terminal profile' })).toHaveTextContent(
      'Configured default'
    );
    expect(screen.getByText(/cannot reattach the previous terminal/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Prepare recovery' })
    ).not.toBeInTheDocument();

    expect(await screen.findByText('codexp')).toBeInTheDocument();
    expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'resume',
      startPrompt: '',
      sessionId: session.id,
      terminalProfileId: null,
      cols: 100,
      rows: 30
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resume saved session' }));
    await waitFor(() => expect(startRuntime).toHaveBeenCalledWith(preview.launchToken));
    expect(onStarted).toHaveBeenCalledWith(startedRuntime, preview);
  });

  it('prepares a fresh restart when no exact current session is linked', async () => {
    const restartPreview = { ...preview, strategy: 'new' as const, sessionId: null };
    const prepareLaunch = vi.fn().mockResolvedValue(restartPreview);
    renderDialog({
      runtime: {
        ...lostRuntime,
        strategy: 'new',
        sessionId: null,
        nativeSessionId: null,
        reconciliationState: 'unresolved'
      },
      sessions: [],
      prepareLaunch
    });

    expect(screen.getAllByText('Restart as new session')).toHaveLength(2);
    await waitFor(() =>
      expect(prepareLaunch).toHaveBeenCalledWith({
        strategy: 'new',
        startPrompt: '',
        provider: 'codex',
        workspaceId: workspace.id,
        terminalProfileId: null,
        cols: 100,
        rows: 30
      })
    );
  });

  it('keeps configured default when the previous profile is unavailable', () => {
    renderDialog({ profiles: [recommendedProfile] });

    expect(screen.getByRole('button', { name: 'Terminal profile' })).toHaveTextContent(
      'Configured default'
    );
  });

  it.each([
    ['workspace', { workspaces: [{ ...workspace, available: false }] }, 'The workspace is unavailable.'],
    ['provider', { providerScan: null }, 'Codex is unavailable.'],
    ['profile', { profiles: [] }, 'No terminal profile is available.']
  ] as const)('blocks preparation when the %s is unavailable', (_name, options, message) => {
    const { prepareLaunch } = renderDialog(options);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume saved session' })).toBeDisabled();
    expect(prepareLaunch).not.toHaveBeenCalled();
  });

  it('reports preparation and start failures inline', async () => {
    const prepareLaunch = vi
      .fn()
      .mockRejectedValueOnce(new Error('prepare'))
      .mockResolvedValue(preview);
    const startRuntime = vi.fn().mockRejectedValue(new Error('start'));
    renderDialog({ prepareLaunch, startRuntime });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The recovery preview could not be prepared.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('codexp');
    fireEvent.click(screen.getByRole('button', { name: 'Resume saved session' }));
    expect(await screen.findByText('The recovered terminal could not be started.')).toBeInTheDocument();
  });

  it('grants trust before starting recovery in an untrusted workspace', async () => {
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
    const action = screen.getByRole('button', { name: 'Resume saved session' });
    expect(action).toBeDisabled();
    fireEvent.click(confirmation);
    await waitFor(() => expect(action).toBeEnabled());
    fireEvent.click(action);

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

  it('does not recover an obsolete token when eligibility changes during trust', async () => {
    const untrustedPreview = { ...preview, workspaceTrusted: false };
    const trust = deferred<{
      workspaceId: string;
      canonicalPath: string;
      trustedAt: string;
    }>();
    const trustWorkspaceForLaunch = vi.fn().mockReturnValue(trust.promise);
    const { rerender, startRuntime } = renderDialog({
      prepareLaunch: vi.fn().mockResolvedValue(untrustedPreview),
      trustWorkspaceForLaunch
    });

    fireEvent.click(await screen.findByRole('checkbox', {
      name: 'I trust this workspace and want to run the provider here'
    }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Resume saved session' })
      ).toBeEnabled()
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Resume saved session' })
    );
    expect(
      screen.getByRole('button', { name: 'Terminal profile' })
    ).toBeDisabled();

    rerender(
      <RuntimeRecoveryDialog
        onClose={vi.fn()}
        onStarted={vi.fn()}
        profiles={[recommendedProfile, previousProfile]}
        providerScan={null}
        runtime={lostRuntime}
        sessions={[session]}
        workspaces={[workspace]}
      />
    );
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

  it('uses a refreshed token after recovery start fails', async () => {
    const refreshedPreview: LaunchPreview = {
      ...preview,
      launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abf'
    };
    const prepareLaunch = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce(refreshedPreview);
    const startRuntime = vi
      .fn()
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce(startedRuntime);
    renderDialog({ prepareLaunch, startRuntime });

    await screen.findByText('codexp');
    fireEvent.click(
      screen.getByRole('button', { name: 'Resume saved session' })
    );
    expect(
      await screen.findByText('The recovered terminal could not be started.')
    ).toHaveAttribute('role', 'alert');
    await waitFor(() => expect(prepareLaunch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Resume saved session' })
      ).toBeEnabled()
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Resume saved session' })
    );
    await waitFor(() =>
      expect(startRuntime).toHaveBeenLastCalledWith(
        refreshedPreview.launchToken
      )
    );
  });
});
