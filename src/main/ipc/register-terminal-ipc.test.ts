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
    prepareLaunch: vi.fn(async (value) => ({ ...value })),
    startRuntime: vi.fn(async () => runtime),
    listRuntimes: vi.fn(() => [runtime]),
    attachRuntime: vi.fn(() => ({ runtime, snapshot: '' })),
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
  it('registers the twelve explicit terminal operations', () => {
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
      IPC_CHANNELS.launchPrepare,
      IPC_CHANNELS.runtimeStart,
      IPC_CHANNELS.runtimeList,
      IPC_CHANNELS.runtimeAttach,
      IPC_CHANNELS.runtimeWrite,
      IPC_CHANNELS.runtimeResize,
      IPC_CHANNELS.runtimeTerminate
    ]);
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
    emit({ type: 'output', runtimeId, data: 'ready' });
    expect(sendRuntimeEvent).toHaveBeenCalledWith({
      type: 'output',
      runtimeId,
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
