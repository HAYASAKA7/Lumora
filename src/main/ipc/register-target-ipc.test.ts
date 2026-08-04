import { describe, expect, it, vi } from 'vitest';

import {
  IPC_CHANNELS,
  type LumoraWindowContext,
  type RemoteTargetSummary
} from '../../shared/contracts';
import { registerTargetIpc } from './register-target-ipc';

const TARGET_ID = '05f4e306-4af2-4c73-9e0d-706084623645';
const OTHER_TARGET_ID = '395612e9-c281-487b-a571-166d62fb15fe';

const summary = {
  target: {
    id: TARGET_ID,
    kind: 'remote',
    displayName: 'Build server',
    platform: 'unknown',
    architecture: 'unknown',
    connectionState: 'offline',
    helperVersion: null,
    protocolVersion: null,
    capabilities: [],
    lastConnectedAt: null,
    lastScannedAt: null
  },
  profile: {
    executionTargetId: TARGET_ID,
    displayName: 'Build server',
    route: 'direct',
    host: 'build.internal',
    port: 22,
    username: 'builder',
    sshConfigHost: null,
    authentication: { method: 'password' },
    verifiedHostFingerprint: null,
    createdAt: '2026-08-04T09:00:00.000Z',
    updatedAt: '2026-08-04T09:00:00.000Z'
  }
} as const satisfies RemoteTargetSummary;

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function createHarness(context: LumoraWindowContext) {
  const handlers = new Map<string, Handler>();
  const service = {
    list: vi.fn(() => [summary]),
    get: vi.fn(() => summary),
    create: vi.fn(() => summary),
    update: vi.fn(() => summary),
    remove: vi.fn(),
    observeHostKey: vi.fn().mockResolvedValue({
      executionTargetId: TARGET_ID,
      fingerprint: 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM'
    }),
    trustHostKey: vi.fn(() => summary),
    connect: vi.fn().mockResolvedValue({
      ...summary,
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    }),
    disconnect: vi.fn(() => summary)
  };
  const openTargetWindow = vi.fn().mockResolvedValue(undefined);
  registerTargetIpc({
    ipc: {
      handle(channel, handler) {
        handlers.set(channel, handler as Handler);
      }
    },
    authorize: vi.fn(() => context),
    service,
    openTargetWindow
  });
  return { handlers, service, openTargetWindow };
}

const event = { senderFrame: { url: 'app://lumora/index.html' }, sender: { id: 1 } };

describe('registerTargetIpc', () => {
  it('lets the local window manage profiles and open a target window', async () => {
    const { handlers, service, openTargetWindow } = createHarness({
      mode: 'local',
      executionTargetId: 'local'
    });
    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.targetWindowContextGet,
      IPC_CHANNELS.remoteTargetList,
      IPC_CHANNELS.remoteTargetCreate,
      IPC_CHANNELS.remoteTargetUpdate,
      IPC_CHANNELS.remoteTargetRemove,
      IPC_CHANNELS.remoteTargetObserveHost,
      IPC_CHANNELS.remoteTargetTrustHost,
      IPC_CHANNELS.remoteTargetConnect,
      IPC_CHANNELS.remoteTargetDisconnect,
      IPC_CHANNELS.remoteTargetWindowOpen
    ]);
    await expect(handlers.get(IPC_CHANNELS.remoteTargetCreate)!(event, {
      displayName: 'Build server',
      route: 'direct',
      host: 'build.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'password' }
    })).resolves.toEqual(summary);
    await expect(handlers.get(IPC_CHANNELS.remoteTargetWindowOpen)!(event, {
      executionTargetId: TARGET_ID
    })).resolves.toEqual({ opened: true, executionTargetId: TARGET_ID });
    expect(service.create).toHaveBeenCalledOnce();
    expect(openTargetWindow).toHaveBeenCalledWith(TARGET_ID);
  });

  it('limits a remote window to reading and connecting its own target', async () => {
    const { handlers, service } = createHarness({
      mode: 'remote',
      executionTargetId: TARGET_ID
    });

    await expect(handlers.get(IPC_CHANNELS.remoteTargetList)!(event))
      .resolves.toEqual([summary]);
    await expect(handlers.get(IPC_CHANNELS.remoteTargetConnect)!(event, {
      executionTargetId: TARGET_ID,
      credentials: { method: 'password', password: 'memory-only' }
    })).resolves.toMatchObject({ target: { id: TARGET_ID } });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetConnect)!(event, {
      executionTargetId: OTHER_TARGET_ID,
      credentials: { method: 'password', password: 'memory-only' }
    })).rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetRemove)!(event, {
      executionTargetId: TARGET_ID
    })).rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    expect(service.connect).toHaveBeenCalledOnce();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('returns the immutable authorized window context', async () => {
    const context = { mode: 'remote', executionTargetId: TARGET_ID } as const;
    const { handlers } = createHarness(context);
    await expect(handlers.get(IPC_CHANNELS.targetWindowContextGet)!(event))
      .resolves.toEqual(context);
  });
});
