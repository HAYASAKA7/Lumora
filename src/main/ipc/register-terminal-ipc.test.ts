import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS, type RuntimeEvent } from '../../shared/contracts';
import { registerTerminalIpc } from './register-terminal-ipc';

type Handler = (
  event: { senderFrame: { url: string } | null },
  ...args: readonly unknown[]
) => Promise<unknown> | unknown;

const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
const runtime = {
  id: runtimeId,
  strategy: 'new' as const,
  sessionId: null,
  nativeSessionId: null,
  reconciliationState: 'pending' as const,
  provider: 'codex' as const,
  workspaceId: 'a'.repeat(64),
  terminalProfileId: 'b'.repeat(64),
  launchHash: 'c'.repeat(64),
  state: 'running' as const,
  pid: 123,
  createdAt: '2026-07-11T04:00:00.000Z',
  startedAt: '2026-07-11T04:00:00.000Z',
  endedAt: null,
  exitCode: null,
  errorCode: null
};
const settingsLayer = {
  scope: 'provider' as const,
  targetId: 'codex' as const,
  settings: { providerCommands: { codex: 'codexp' } },
  updatedAt: '2026-07-13T00:00:00.000Z'
};
const trustDecision = {
  workspaceId: 'a'.repeat(64),
  canonicalPath: 'D:\\Projects\\Lumora',
  trustedAt: '2026-07-13T08:00:00.000Z'
};

function createHarness() {
  const handlers = new Map<string, Handler>();
  let eventListener: ((event: RuntimeEvent) => void) | null = null;
  const runtimeService = {
    getProfiles: vi.fn(() => []),
    saveProfile: vi.fn(async () => []),
    deleteProfile: vi.fn(() => []),
    getProviderLaunchConfigs: vi.fn(() => [
      { provider: 'codex' as const, command: null },
      { provider: 'claude' as const, command: null }
    ]),
    saveProviderLaunchConfig: vi.fn(() => [
      { provider: 'codex' as const, command: 'codexp' },
      { provider: 'claude' as const, command: null }
    ]),
    getLaunchSettingsLayers: vi.fn(() => [settingsLayer]),
    saveLaunchSettingsLayer: vi.fn(() => [settingsLayer]),
    prepareLaunch: vi.fn(async (value) => ({ ...value })),
    getWorkspaceTrustDecisions: vi.fn(() => [trustDecision]),
    trustWorkspaceForLaunch: vi.fn(() => trustDecision),
    revokeWorkspaceTrust: vi.fn(() => []),
    startRuntime: vi.fn(async () => runtime),
    listRuntimes: vi.fn(() => [runtime]),
    attachRuntime: vi.fn(() => ({
      runtime,
      snapshot: '',
      outputSequence: 0
    })),
    writeRuntime: vi.fn(),
    resizeRuntime: vi.fn(),
    terminateRuntime: vi.fn(async () => runtime),
    subscribe: vi.fn((listener: (event: RuntimeEvent) => void) => {
      eventListener = listener;
      return () => { eventListener = null; };
    })
  };
  const sendRuntimeEvent = vi.fn();
  registerTerminalIpc({
    ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
    runtime: runtimeService,
    sendRuntimeEvent
  });
  return {
    handlers,
    runtimeService,
    sendRuntimeEvent,
    emit(event: RuntimeEvent) { eventListener?.(event); }
  };
}

const trustedEvent = { senderFrame: { url: 'app://lumora/index.html' } };

describe('registerTerminalIpc', () => {
  it('registers the seventeen explicit terminal operations', () => {
    const { handlers } = createHarness();
    const channels = IPC_CHANNELS as typeof IPC_CHANNELS & {
      providerLaunchConfigsGet: string;
      providerLaunchConfigSave: string;
    };
    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.terminalProfilesGet,
      IPC_CHANNELS.terminalProfileSave,
      IPC_CHANNELS.terminalProfileDelete,
      channels.providerLaunchConfigsGet,
      channels.providerLaunchConfigSave,
      IPC_CHANNELS.launchSettingsLayersGet,
      IPC_CHANNELS.launchSettingsLayerSave,
      IPC_CHANNELS.launchPrepare,
      IPC_CHANNELS.workspaceTrustGet,
      IPC_CHANNELS.workspaceTrustGrant,
      IPC_CHANNELS.workspaceTrustRevoke,
      IPC_CHANNELS.runtimeStart,
      IPC_CHANNELS.runtimeList,
      IPC_CHANNELS.runtimeAttach,
      IPC_CHANNELS.runtimeWrite,
      IPC_CHANNELS.runtimeResize,
      IPC_CHANNELS.runtimeTerminate
    ]);
  });

  it('validates and forwards workspace trust operations', async () => {
    const { handlers, runtimeService } = createHarness();
    const launchToken = '0198f8b6-18f3-7ca0-9f0f-123456789abc';

    await expect(
      handlers.get(IPC_CHANNELS.workspaceTrustGet)!(trustedEvent)
    ).resolves.toEqual([trustDecision]);
    await expect(
      handlers.get(IPC_CHANNELS.workspaceTrustGrant)!(trustedEvent, {
        launchToken
      })
    ).resolves.toEqual(trustDecision);
    expect(runtimeService.trustWorkspaceForLaunch).toHaveBeenCalledWith(
      launchToken
    );
    await expect(
      handlers.get(IPC_CHANNELS.workspaceTrustRevoke)!(trustedEvent, {
        workspaceId: trustDecision.workspaceId
      })
    ).resolves.toEqual([]);
    expect(runtimeService.revokeWorkspaceTrust).toHaveBeenCalledWith(
      trustDecision.workspaceId
    );

    await expect(
      Promise.resolve().then(() =>
        handlers.get(IPC_CHANNELS.workspaceTrustGrant)!(trustedEvent, {
          launchToken: 'not-a-uuid'
        })
      )
    ).rejects.toBeDefined();
    await expect(
      Promise.resolve().then(() =>
        handlers.get(IPC_CHANNELS.workspaceTrustRevoke)!(trustedEvent, {
          workspaceId: '../escape'
        })
      )
    ).rejects.toBeDefined();
    expect(runtimeService.trustWorkspaceForLaunch).toHaveBeenCalledOnce();
    expect(runtimeService.revokeWorkspaceTrust).toHaveBeenCalledOnce();
  });

  it('rejects malformed workspace trust responses', async () => {
    const { handlers, runtimeService } = createHarness();
    runtimeService.getWorkspaceTrustDecisions.mockReturnValue([
      { ...trustDecision, canonicalPath: '' }
    ]);

    await expect(
      handlers.get(IPC_CHANNELS.workspaceTrustGet)!(trustedEvent)
    ).rejects.toMatchObject({ code: 'TERMINAL_OPERATION_FAILED' });
  });

  it('validates and forwards layered launch settings', async () => {
    const { handlers, runtimeService } = createHarness();
    await expect(
      handlers.get(IPC_CHANNELS.launchSettingsLayersGet)!(trustedEvent)
    ).resolves.toEqual([settingsLayer]);
    await expect(
      handlers.get(IPC_CHANNELS.launchSettingsLayerSave)!(trustedEvent, {
        scope: 'provider',
        targetId: 'codex',
        settings: { providerCommands: { codex: 'codexp' } }
      })
    ).resolves.toEqual([settingsLayer]);
    expect(runtimeService.saveLaunchSettingsLayer).toHaveBeenCalledWith({
      scope: 'provider',
      targetId: 'codex',
      settings: { providerCommands: { codex: 'codexp' } }
    });
    await expect(
      Promise.resolve().then(() =>
        handlers.get(IPC_CHANNELS.launchSettingsLayerSave)!(trustedEvent, {
          scope: 'provider',
          targetId: 'codex',
          settings: { providerCommands: { claude: 'wrong-provider' } }
        })
      )
    ).rejects.toBeDefined();
  });

  it('validates and forwards provider launch configuration', async () => {
    const { handlers, runtimeService } = createHarness();
    const channels = IPC_CHANNELS as typeof IPC_CHANNELS & {
      providerLaunchConfigsGet: string;
      providerLaunchConfigSave: string;
    };

    await expect(
      handlers.get(channels.providerLaunchConfigsGet)!(trustedEvent)
    ).resolves.toEqual([
      { provider: 'codex', command: null },
      { provider: 'claude', command: null }
    ]);
    await expect(
      handlers.get(channels.providerLaunchConfigSave)!(trustedEvent, {
        provider: 'codex',
        command: 'codexp'
      })
    ).resolves.toEqual([
      { provider: 'codex', command: 'codexp' },
      { provider: 'claude', command: null }
    ]);
    expect(runtimeService.saveProviderLaunchConfig).toHaveBeenCalledWith({
      provider: 'codex',
      command: 'codexp'
    });
  });

  it('validates runtime commands before forwarding them', async () => {
    const { handlers, runtimeService } = createHarness();
    await expect(
      Promise.resolve().then(() =>
        handlers.get(IPC_CHANNELS.runtimeWrite)!(trustedEvent, {
          runtimeId,
          data: 'hello'
        })
      )
    ).resolves.toEqual({ accepted: true });
    expect(runtimeService.writeRuntime).toHaveBeenCalledWith({
      runtimeId,
      data: 'hello'
    });

    await expect(
      Promise.resolve().then(() =>
        handlers.get(IPC_CHANNELS.runtimeResize)!(trustedEvent, {
          runtimeId,
          cols: 2,
          rows: 2
        })
      )
    ).rejects.toBeDefined();
    expect(runtimeService.resizeRuntime).not.toHaveBeenCalled();
  });

  it('rejects foreign senders before calling privileged services', async () => {
    const { handlers, runtimeService } = createHarness();
    await expect(
      Promise.resolve().then(() =>
        handlers.get(IPC_CHANNELS.runtimeList)!({
          senderFrame: { url: 'https://example.com' }
        })
      )
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    expect(runtimeService.listRuntimes).not.toHaveBeenCalled();
  });

  it('forwards validated runtime events to the narrow broadcaster', () => {
    const { emit, sendRuntimeEvent } = createHarness();
    emit({ type: 'output', runtimeId, sequence: 1, data: 'ready' });
    expect(sendRuntimeEvent).toHaveBeenCalledWith({
      type: 'output',
      runtimeId,
      sequence: 1,
      data: 'ready'
    });
  });

  it('normalizes privileged failures without exposing process details', async () => {
    const { handlers, runtimeService } = createHarness();
    runtimeService.listRuntimes.mockImplementation(() => {
      throw new Error('C:\\secret\\pty.node failed');
    });

    await expect(
      handlers.get(IPC_CHANNELS.runtimeList)!(trustedEvent)
    ).rejects.toMatchObject({
      code: 'TERMINAL_OPERATION_FAILED',
      message: 'Lumora could not complete the terminal operation.'
    });
  });
});
