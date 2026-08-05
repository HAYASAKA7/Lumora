import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../shared/contracts';
import { createLumoraApi } from './api';

const TARGET_ID = '5dd607fb-cd81-4a17-bb5f-0fba91ad631f';
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
} as const;

describe('remote target preload API', () => {
  it('validates and routes the target-management operations', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.targetWindowContextGet) {
        return { mode: 'local', executionTargetId: 'local' };
      }
      if (channel === IPC_CHANNELS.remoteTargetList) return [summary];
      if (channel === IPC_CHANNELS.remoteTargetObserveHost) {
        return {
          executionTargetId: TARGET_ID,
          fingerprint: 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM'
        };
      }
      if (channel === IPC_CHANNELS.remoteTargetConnect) {
        return { ...summary, homeDirectory: '/home/builder', defaultShell: '/bin/bash' };
      }
      if (channel === IPC_CHANNELS.remoteTargetHelperDetails) {
        return {
          status: 'missing', helperVersion: '0.1.0',
          installLocation: '/home/builder/.local/share/lumora/helper/lumora-helper',
          requiresConfirmation: true
        };
      }
      if (channel === IPC_CHANNELS.remoteTargetHelperInstall) {
        return {
          ...summary,
          target: { ...summary.target, connectionState: 'ready' },
          homeDirectory: '/home/builder', defaultShell: '/bin/bash'
        };
      }
      if (channel === IPC_CHANNELS.remoteTargetRemove) return { removed: true };
      if (channel === IPC_CHANNELS.remoteTargetWindowOpen) {
        return { opened: true, executionTargetId: TARGET_ID };
      }
      return summary;
    });
    const api = createLumoraApi(invoke);

    await expect(api.getWindowContext()).resolves.toEqual({
      mode: 'local', executionTargetId: 'local'
    });
    await expect(api.listRemoteTargets()).resolves.toEqual([summary]);
    await expect(api.observeRemoteHost(TARGET_ID)).resolves.toMatchObject({
      executionTargetId: TARGET_ID
    });
    await expect(api.connectRemoteTarget({
      executionTargetId: TARGET_ID,
      credentials: { method: 'password', password: 'memory-only' }
    })).resolves.toMatchObject({ homeDirectory: '/home/builder' });
    await expect(api.removeRemoteTarget(TARGET_ID)).resolves.toBeUndefined();
    await expect(api.getRemoteHelperInstallDetails()).resolves.toMatchObject({
      status: 'missing', requiresConfirmation: true
    });
    await expect(api.installRemoteHelper()).resolves.toMatchObject({
      target: { connectionState: 'ready' }
    });
    await expect(api.openRemoteTargetWindow(TARGET_ID)).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.remoteTargetConnect, {
      executionTargetId: TARGET_ID,
      credentials: { method: 'password', password: 'memory-only' }
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.remoteTargetHelperDetails);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.remoteTargetHelperInstall);
  });

  it('rejects malformed requests before invoking IPC', async () => {
    const invoke = vi.fn();
    const api = createLumoraApi(invoke);

    await expect(api.connectRemoteTarget({
      executionTargetId: 'not-a-uuid',
      credentials: { method: 'password', password: 'secret' }
    })).rejects.toBeDefined();
    await expect(api.createRemoteTarget({
      displayName: 'Invalid',
      route: 'direct',
      host: 'host',
      port: 70_000,
      username: 'builder',
      authentication: { method: 'agent' }
    })).rejects.toBeDefined();
    expect(invoke).not.toHaveBeenCalled();
  });
});
