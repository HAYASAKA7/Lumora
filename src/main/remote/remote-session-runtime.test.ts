import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderId,
  RemoteDiscoverySnapshot,
  RemoteSessionCatalog
} from '../../shared/contracts';
import {
  SESSION_PROVIDER_IDS,
  providerDefinition
} from '../../shared/provider-definitions';
import { createSessionId } from '../catalog/catalog-candidate';
import { ExecutionTargetRepository } from '../storage/execution-target-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import {
  buildNewArguments,
  buildResumeArguments
} from '../providers/launch-command';
import { buildRemotePtyCommand } from './remote-pty-command';
import {
  createRemoteSessionRuntime,
  createRemoteWorkspaceId
} from './remote-session-runtime';

const TARGET_ID = 'b032eb7d-70d0-4b78-b8ce-f228458b44e3';
const WORKSPACE_PATH = '/home/builder/lumora';
const WORKSPACE_ID = createRemoteWorkspaceId(TARGET_ID, WORKSPACE_PATH);
const SCANNED_AT = '2026-08-10T05:00:00.000Z';

function discovery(): RemoteDiscoverySnapshot {
  return {
    executionTargetId: TARGET_ID,
    scannedAt: SCANNED_AT,
    environment: {
      checkedAt: SCANNED_AT,
      node: {
        state: 'ready',
        executablePath: '/usr/bin/node',
        version: 'v22.0.0'
      },
      npm: {
        state: 'ready',
        executablePath: '/usr/bin/npm',
        version: '10.0.0'
      }
    },
    providers: {
      scannedAt: SCANNED_AT,
      providers: SESSION_PROVIDER_IDS.map((provider) => ({
        provider,
        displayName: providerDefinition(provider).displayName,
        command: providerDefinition(provider).command,
        state: 'ready' as const,
        executablePath: `/opt/lumora/${provider}`,
        version: '1.2.3',
        issue: null
      }))
    }
  };
}

function catalog(): RemoteSessionCatalog {
  const sessions = SESSION_PROVIDER_IDS.map((provider, index) => ({
    provider,
    nativeId: `${provider}-native-${index}`,
    workspacePath: WORKSPACE_PATH,
    title: `${providerDefinition(provider).displayName} remote session`,
    createdAt: '2026-08-09T05:00:00.000Z',
    updatedAt: SCANNED_AT,
    lifetimeTokens: index + 1
  }));
  return {
    executionTargetId: TARGET_ID,
    scannedAt: SCANNED_AT,
    sessions,
    providers: SESSION_PROVIDER_IDS.map((provider) => ({
      provider,
      status: 'ready' as const,
      sessionCount: 1,
      invalidCount: 0
    })),
    snapshot: {
      refreshedAt: SCANNED_AT,
      workspaces: [{
        id: WORKSPACE_ID,
        canonicalPath: WORKSPACE_PATH,
        displayName: 'lumora',
        available: true,
        origin: 'discovered',
        sessionCount: sessions.length,
        providerCounts: Object.fromEntries(
          SESSION_PROVIDER_IDS.map((provider) => [provider, 1])
        ),
        lastActivityAt: SCANNED_AT
      }],
      sessions: sessions.map((session) => ({
        id: createSessionId(session.provider, session.nativeId, TARGET_ID),
        provider: session.provider,
        nativeId: session.nativeId,
        workspaceId: WORKSPACE_ID,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lifetimeTokens: session.lifetimeTokens,
        lifecycle: 'saved',
        sourceFreshness: 'current'
      })),
      providerStatus: SESSION_PROVIDER_IDS.map((provider) => ({
        provider,
        state: 'ready',
        discoveredCount: 1,
        unchangedCount: 0,
        invalidCount: 0
      })),
      providerFacets: SESSION_PROVIDER_IDS.map((provider) => ({
        provider,
        sessionCount: 1
      })),
      diagnostics: []
    }
  };
}

function createHarness(options: { immediateReconciliation?: boolean } = {}) {
  const database = new DatabaseSync(':memory:');
  migrateCatalogDatabase(database);
  new ExecutionTargetRepository(database).createRemote({
    id: TARGET_ID,
    displayName: 'Build server'
  });
  const currentDiscovery = discovery();
  let currentCatalog = catalog();
  const channels: Array<{
    pid: null;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    onData(listener: (data: string) => void): { dispose(): void };
    onExit(listener: (event: { exitCode: number | null }) => void): {
      dispose(): void;
    };
    emitData(data: string): void;
    emitExit(exitCode: number | null): void;
  }> = [];
  const openPty = vi.fn(async () => {
    let dataListener: ((data: string) => void) | null = null;
    let exitListener: ((event: { exitCode: number | null }) => void) | null = null;
    const write = vi.fn((data: string) => {
      if (data === '\u0003') exitListener?.({ exitCode: 0 });
    });
    const channel = {
      pid: null as null,
      write,
      resize: vi.fn(),
      kill: vi.fn(),
      onData(listener: (data: string) => void) {
        dataListener = listener;
        return { dispose: () => { dataListener = null; } };
      },
      onExit(listener: (event: { exitCode: number | null }) => void) {
        exitListener = listener;
        return { dispose: () => { exitListener = null; } };
      },
      emitData(data: string) {
        dataListener?.(data);
      },
      emitExit(exitCode: number | null) {
        exitListener?.({ exitCode });
      }
    };
    channels.push(channel);
    return channel;
  });
  const runtime = createRemoteSessionRuntime({
    database,
    executionTargetId: TARGET_ID,
    platform: 'linux',
    defaultShell: '/bin/bash',
    scanDiscovery: vi.fn(async () => currentDiscovery),
    scanSessions: vi.fn(async () => currentCatalog),
    enabledProviders: () => SESSION_PROVIDER_IDS,
    openPty,
    ...(options.immediateReconciliation
      ? {
          reconciliationDelays: [0],
          reconciliationWait: async () => undefined
        }
      : {})
  });
  runtime.updateCatalog(currentCatalog);
  return {
    database,
    runtime,
    openPty,
    channels,
    setCatalog(nextCatalog: RemoteSessionCatalog) {
      currentCatalog = nextCatalog;
    }
  };
}

describe('remote session runtime', () => {
  it('exposes one target-owned SSH profile and target-scoped trust state', () => {
    const { database, runtime } = createHarness();

    expect(runtime.getProfiles()).toEqual([
      expect.objectContaining({
        kind: 'detected',
        name: 'Remote SSH PTY',
        shellFamily: 'bash',
        executablePath: '/bin/bash',
        available: true,
        recommended: true
      })
    ]);
    expect(runtime.getWorkspaceTrustDecisions()).toEqual([]);
    expect(runtime.getProviderLaunchConfigs()).toEqual(
      SESSION_PROVIDER_IDS.map((provider) => ({ provider, command: null }))
    );
    expect(runtime.getLaunchSettingsLayers()).toEqual([]);
    expect(runtime.getGeneralSettings()).toMatchObject({
      crossAgentWorkflowEnabled: false,
      enabledProviders: SESSION_PROVIDER_IDS
    });
    expect(runtime.workspaceVisibility.setPolicy({
      workspaceId: WORKSPACE_ID,
      mode: 'workspace_and_sessions'
    })).toEqual([
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        mode: 'workspace_and_sessions'
      })
    ]);

    runtime.close();
    database.close();
  });

  it('persists global General settings from a remote window', () => {
    const { database, runtime } = createHarness();
    const saved = runtime.saveGeneralSettings({
      ...runtime.getGeneralSettings(),
      showInformationalNotices: false,
      showUnavailableWorkspaces: false,
      checkProviderUpdatesAutomatically: false,
      crossAgentWorkflowEnabled: true,
      crossAgentHandoffRetentionDays: 7
    });

    expect(saved).toMatchObject({
      showInformationalNotices: false,
      showUnavailableWorkspaces: false,
      checkProviderUpdatesAutomatically: false,
      crossAgentWorkflowEnabled: true,
      crossAgentHandoffRetentionDays: 7,
      enabledProviders: SESSION_PROVIDER_IDS
    });
    expect(runtime.getGeneralSettings()).toMatchObject({
      showInformationalNotices: false,
      showUnavailableWorkspaces: false,
      checkProviderUpdatesAutomatically: false,
      crossAgentWorkflowEnabled: true,
      crossAgentHandoffRetentionDays: 7,
      enabledProviders: SESSION_PROVIDER_IDS
    });

    runtime.close();
    database.close();
  });

  it('persists a target-scoped custom provider command and launches it through the remote shell', async () => {
    const { database, runtime, openPty } = createHarness();
    const layers = runtime.saveLaunchSettingsLayer({
      scope: 'provider',
      targetId: 'codex',
      settings: {
        providerCommands: { codex: 'codexp --remote-profile' }
      }
    });

    expect(layers).toEqual([
      expect.objectContaining({
        scope: 'provider',
        targetId: 'codex',
        settings: {
          providerCommands: { codex: 'codexp --remote-profile' }
        }
      })
    ]);

    const preview = await runtime.prepareLaunch({
      strategy: 'new',
      workspaceId: WORKSPACE_ID,
      provider: 'codex',
      terminalProfileId: null,
      startPrompt: '',
      cols: 100,
      rows: 30
    });
    expect(preview.command).toBe('codexp --remote-profile');
    runtime.trustWorkspaceForLaunch(preview.launchToken);
    await runtime.startRuntime(preview.launchToken);

    expect(openPty).toHaveBeenCalledWith(
      expect.stringContaining(
        "LUMORA_PROVIDER_COMMAND=codexp --remote-profile"
      ),
      { cols: 100, rows: 30 }
    );

    await runtime.shutdown();
    runtime.close();
    database.close();
  });

  it.each([
    {
      platform: 'darwin' as const,
      workspacePath: '/Users/builder/lumora',
      defaultShell: '/bin/zsh',
      providerPath: '/usr/local/bin/codex'
    },
    {
      platform: 'win32' as const,
      workspacePath: 'C:\\Users\\builder\\lumora',
      defaultShell:
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      providerPath: 'C:\\Users\\builder\\AppData\\Roaming\\npm\\codex.cmd'
    }
  ])(
    'launches a target-scoped custom command on $platform',
    async ({ platform, workspacePath, defaultShell, providerPath }) => {
      const database = new DatabaseSync(':memory:');
      migrateCatalogDatabase(database);
      new ExecutionTargetRepository(database).createRemote({
        id: TARGET_ID,
        displayName: 'Build server'
      });
      const workspaceId = createRemoteWorkspaceId(TARGET_ID, workspacePath);
      const remoteCatalog: RemoteSessionCatalog = {
        executionTargetId: TARGET_ID,
        scannedAt: SCANNED_AT,
        sessions: [{
          provider: 'codex',
          nativeId: 'existing-session',
          workspacePath,
          title: 'Existing remote session',
          createdAt: SCANNED_AT,
          updatedAt: SCANNED_AT,
          lifetimeTokens: null
        }],
        providers: [{
          provider: 'codex', status: 'ready', sessionCount: 1, invalidCount: 0
        }],
        snapshot: {
          refreshedAt: SCANNED_AT,
          workspaces: [{
            id: workspaceId,
            canonicalPath: workspacePath,
            displayName: 'lumora',
            available: true,
            origin: 'discovered',
            sessionCount: 1,
            providerCounts: { codex: 1 },
            lastActivityAt: SCANNED_AT
          }],
          sessions: [],
          providerStatus: [{
            provider: 'codex', state: 'ready', discoveredCount: 0,
            unchangedCount: 0, invalidCount: 0
          }],
          providerFacets: [],
          diagnostics: []
        }
      };
      const remoteDiscovery: RemoteDiscoverySnapshot = {
        executionTargetId: TARGET_ID,
        scannedAt: SCANNED_AT,
        environment: {
          checkedAt: SCANNED_AT,
          node: { state: 'not_found', executablePath: null, version: null },
          npm: { state: 'not_found', executablePath: null, version: null }
        },
        providers: {
          scannedAt: SCANNED_AT,
          providers: [{
            provider: 'codex', displayName: 'Codex',
            state: 'ready', executablePath: providerPath,
            version: '1.2.3', issue: null
          }]
        }
      };
      const openPty = vi.fn(async (
        _command: string,
        _size: { cols: number; rows: number }
      ) => {
        let exitListener: ((event: { exitCode: number | null }) => void) | null = null;
        return {
          pid: null,
          write: vi.fn((data: string) => {
            if (data === '\u0003') exitListener?.({ exitCode: 0 });
          }),
          resize: vi.fn(),
          kill: vi.fn(),
          onData: vi.fn(() => ({ dispose: vi.fn() })),
          onExit: vi.fn((
            listener: (event: { exitCode: number | null }) => void
          ) => {
            exitListener = listener;
            return { dispose: vi.fn() };
          })
        };
      });
      const runtime = createRemoteSessionRuntime({
        database,
        executionTargetId: TARGET_ID,
        platform,
        defaultShell,
        scanDiscovery: async () => remoteDiscovery,
        scanSessions: async () => remoteCatalog,
        enabledProviders: () => ['codex'],
        openPty
      });
      runtime.updateCatalog(remoteCatalog);
      runtime.saveLaunchSettingsLayer({
        scope: 'provider',
        targetId: 'codex',
        settings: {
          providerCommands: { codex: 'codexp --remote-profile' }
        }
      });
      const preview = await runtime.prepareLaunch({
        strategy: 'new',
        workspaceId,
        provider: 'codex',
        terminalProfileId: null,
        startPrompt: '',
        cols: 100,
        rows: 30
      });
      runtime.trustWorkspaceForLaunch(preview.launchToken);

      await runtime.startRuntime(preview.launchToken);

      const command = openPty.mock.calls[0]?.[0];
      expect(command).toEqual(expect.any(String));
      if (platform === 'win32') {
        const encoded = command?.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/u)?.[1];
        expect(encoded).toBeDefined();
        expect(Buffer.from(encoded!, 'base64').toString('utf16le')).toContain(
          "$env:LUMORA_PROVIDER_COMMAND = 'codexp --remote-profile';"
        );
        expect(Buffer.from(encoded!, 'base64').toString('utf16le')).toContain(
          `& '${defaultShell}'`
        );
      } else {
        expect(command).toContain("exec env 'LUMORA_PROVIDER_COMMAND=codexp --remote-profile'");
        expect(command).toContain("'/bin/zsh'");
        expect(command).toContain("'-l' '-i' '-c'");
      }

      await runtime.shutdown();
      runtime.close();
      database.close();
    }
  );

  it('prepares exact resume launches for every managed provider', async () => {
    const { database, runtime } = createHarness();

    for (const [index, provider] of SESSION_PROVIDER_IDS.entries()) {
      const nativeId = `${provider}-native-${index}`;
      const startPrompt = provider === 'kimi' ? '' : 'Continue safely';
      const preview = await runtime.prepareLaunch({
        strategy: 'resume',
        sessionId: createSessionId(provider, nativeId, TARGET_ID),
        provider,
        terminalProfileId: null,
        startPrompt,
        cols: 100,
        rows: 30
      });

      expect(preview).toMatchObject({
        strategy: 'resume',
        provider,
        sessionId: createSessionId(provider, nativeId, TARGET_ID),
        executablePath: `/opt/lumora/${provider}`,
        args: buildResumeArguments(provider as ProviderId, nativeId, startPrompt),
        workingDirectory: WORKSPACE_PATH,
        environmentNames: []
      });
    }

    await runtime.shutdown();
    runtime.close();
    database.close();
  });

  it('starts every managed provider in a target-owned SSH PTY', async () => {
    const { database, runtime, openPty } = createHarness();

    for (const [index, provider] of SESSION_PROVIDER_IDS.entries()) {
      const nativeId = `${provider}-native-${index}`;
      const preview = await runtime.prepareLaunch({
        strategy: 'resume',
        sessionId: createSessionId(provider, nativeId, TARGET_ID),
        provider,
        terminalProfileId: null,
        startPrompt: '',
        cols: 110,
        rows: 32
      });
      if (!preview.workspaceTrusted) {
        runtime.trustWorkspaceForLaunch(preview.launchToken);
      }

      const running = await runtime.startRuntime(preview.launchToken);

      expect(running).toMatchObject({
        strategy: 'resume',
        provider,
        nativeSessionId: nativeId,
        pid: null,
        state: 'running'
      });
      expect(openPty).toHaveBeenLastCalledWith(
        buildRemotePtyCommand({
          platform: 'linux',
          cwd: WORKSPACE_PATH,
          executablePath: '/bin/bash',
          args: [
            '-l',
            '-c',
            'exec "$LUMORA_PROVIDER_EXECUTABLE" "$@"',
            'lumora-provider',
            ...buildResumeArguments(provider, nativeId)
          ],
          env: {
            LUMORA_PROVIDER_EXECUTABLE: `/opt/lumora/${provider}`
          }
        }),
        { cols: 110, rows: 32 }
      );
    }

    await runtime.shutdown();
    runtime.close();
    database.close();
  });

  it('starts a new remote session for every managed provider', async () => {
    const { database, runtime, openPty } = createHarness();

    for (const provider of SESSION_PROVIDER_IDS) {
      const startPrompt = provider === 'kimi' ? '' : 'Start remotely';
      const preview = await runtime.prepareLaunch({
        strategy: 'new',
        workspaceId: WORKSPACE_ID,
        provider,
        terminalProfileId: null,
        startPrompt,
        cols: 90,
        rows: 28
      });
      if (!preview.workspaceTrusted) {
        runtime.trustWorkspaceForLaunch(preview.launchToken);
      }

      const running = await runtime.startRuntime(preview.launchToken);

      expect(running).toMatchObject({
        strategy: 'new',
        provider,
        sessionId: null,
        nativeSessionId: null,
        pid: null,
        state: 'running'
      });
      expect(openPty).toHaveBeenLastCalledWith(
        buildRemotePtyCommand({
          platform: 'linux',
          cwd: WORKSPACE_PATH,
          executablePath: '/bin/bash',
          args: [
            '-l',
            '-c',
            ...(buildNewArguments(provider, startPrompt).length === 0
              ? ['exec "$LUMORA_PROVIDER_EXECUTABLE"']
              : [
                  'exec "$LUMORA_PROVIDER_EXECUTABLE" "$@"',
                  'lumora-provider',
                  ...buildNewArguments(provider, startPrompt)
                ])
          ],
          env: {
            LUMORA_PROVIDER_EXECUTABLE: `/opt/lumora/${provider}`
          }
        }),
        { cols: 90, rows: 28 }
      );
    }

    await runtime.shutdown();
    runtime.close();
    database.close();
  });

  it('links a new remote runtime to the native session created by the provider', async () => {
    const { database, runtime, setCatalog } = createHarness({
      immediateReconciliation: true
    });
    const preview = await runtime.prepareLaunch({
      strategy: 'new',
      workspaceId: WORKSPACE_ID,
      provider: 'codex',
      terminalProfileId: null,
      startPrompt: '',
      cols: 100,
      rows: 30
    });
    runtime.trustWorkspaceForLaunch(preview.launchToken);
    const createdNativeId = 'codex-created-remotely';
    setCatalog({
      ...catalog(),
      scannedAt: '2026-08-10T05:01:00.000Z',
      sessions: [
        ...catalog().sessions,
        {
          provider: 'codex',
          nativeId: createdNativeId,
          workspacePath: WORKSPACE_PATH,
          title: 'Created on the remote target',
          createdAt: '2026-08-10T05:01:00.000Z',
          updatedAt: '2026-08-10T05:01:00.000Z',
          lifetimeTokens: null
        }
      ]
    });

    const running = await runtime.startRuntime(preview.launchToken);

    await vi.waitFor(() => {
      expect(runtime.listRuntimes()).toContainEqual(
        expect.objectContaining({
          id: running.id,
          reconciliationState: 'linked',
          nativeSessionId: createdNativeId,
          displayName: 'Created on the remote target'
        })
      );
    });

    await runtime.shutdown();
    runtime.close();
    database.close();
  });

  it('exposes the existing terminal input, output, resize, attach, and stop lifecycle', async () => {
    const { database, runtime, channels } = createHarness();
    const preview = await runtime.prepareLaunch({
      strategy: 'new',
      workspaceId: WORKSPACE_ID,
      provider: 'codex',
      terminalProfileId: null,
      startPrompt: '',
      cols: 80,
      rows: 24
    });
    runtime.trustWorkspaceForLaunch(preview.launchToken);
    const events: unknown[] = [];
    runtime.subscribe((event) => events.push(event));
    const running = await runtime.startRuntime(preview.launchToken);
    const channel = channels[0]!;

    runtime.writeRuntime({ runtimeId: running.id, data: 'hello' });
    runtime.resizeRuntime({ runtimeId: running.id, cols: 120, rows: 40 });
    channel.emitData('remote output');
    const attached = runtime.attachRuntime(running.id);
    const listed = runtime.listRuntimes();
    channel.emitExit(0);

    expect(channel.write).toHaveBeenCalledWith('hello');
    expect(channel.resize).toHaveBeenCalledWith(120, 40);
    expect(attached.snapshot).toContain('remote output');
    expect(listed).toEqual([expect.objectContaining({ id: running.id })]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'output',
      runtimeId: running.id,
      data: 'remote output'
    }));

    await runtime.shutdown();
    runtime.close();
    database.close();
  });
});
