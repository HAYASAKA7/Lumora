import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERAL_SETTINGS, IPC_CHANNELS } from '../shared/contracts';
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

const lifecycleSnapshot = {
  summary,
  generation: 0,
  discovery: null,
  catalog: null,
  discoveryState: 'idle',
  catalogState: 'idle',
  activeTerminalCount: 0
} as const;

describe('remote target preload API', () => {
  it('validates and routes the target-management operations', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.targetWindowContextGet) {
        return { mode: 'local', executionTargetId: 'local' };
      }
      if (channel === IPC_CHANNELS.remoteTargetList) return [summary];
      if (channel === IPC_CHANNELS.remoteLifecycleList) {
        return [lifecycleSnapshot];
      }
      if (channel === IPC_CHANNELS.remoteTargetObserveHost) {
        return {
          executionTargetId: TARGET_ID,
          fingerprint: 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM'
        };
      }
      if (channel === IPC_CHANNELS.remoteTargetConnect) {
        return { ...summary, homeDirectory: '/home/builder', defaultShell: '/bin/bash' };
      }
      if (
        channel === IPC_CHANNELS.remoteCredentialStatus ||
        channel === IPC_CHANNELS.remoteCredentialForget
      ) {
        return {
          executionTargetId: TARGET_ID,
          storageState: 'available',
          credentialState: channel === IPC_CHANNELS.remoteCredentialForget
            ? 'none'
            : 'remembered',
          autoConnect: false
        };
      }
      if (channel === IPC_CHANNELS.remoteAutoConnectPreferenceSave) {
        return {
          executionTargetId: TARGET_ID,
          storageState: 'available',
          credentialState: 'remembered',
          autoConnect: true
        };
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
      if (channel === IPC_CHANNELS.appearancePresentationGet) {
        return {
          appearance: DEFAULT_GENERAL_SETTINGS.appearance,
          background: { available: false, revision: null }
        };
      }
      return summary;
    });
    const api = createLumoraApi(invoke);

    await expect(api.getWindowContext()).resolves.toEqual({
      mode: 'local', executionTargetId: 'local'
    });
    await expect(api.listRemoteTargets()).resolves.toEqual([summary]);
    await expect(api.listRemoteLifecycleSnapshots()).resolves.toEqual([
      lifecycleSnapshot
    ]);
    await expect(api.observeRemoteHost(TARGET_ID)).resolves.toMatchObject({
      executionTargetId: TARGET_ID
    });
    await expect(api.connectRemoteTarget({
      executionTargetId: TARGET_ID,
      mode: 'manual',
      credentials: { method: 'password', password: 'memory-only' },
      rememberCredential: true
    })).resolves.toMatchObject({ homeDirectory: '/home/builder' });
    await expect(api.connectRemoteTarget({
      executionTargetId: TARGET_ID,
      mode: 'remembered'
    })).resolves.toMatchObject({ homeDirectory: '/home/builder' });
    await expect(api.getRemoteCredentialStatus(TARGET_ID)).resolves
      .toMatchObject({ credentialState: 'remembered' });
    await expect(api.setRemoteAutoConnect(TARGET_ID, true)).resolves
      .toMatchObject({ autoConnect: true });
    await expect(api.forgetRemoteCredential(TARGET_ID)).resolves
      .toMatchObject({ credentialState: 'none' });
    await expect(api.removeRemoteTarget(TARGET_ID)).resolves.toBeUndefined();
    await expect(api.getRemoteHelperInstallDetails()).resolves.toMatchObject({
      status: 'missing', requiresConfirmation: true
    });
    await expect(api.installRemoteHelper()).resolves.toMatchObject({
      target: { connectionState: 'ready' }
    });
    await expect(api.openRemoteTargetWindow(TARGET_ID)).resolves.toBeUndefined();
    await expect(api.getAppearancePresentation()).resolves.toEqual({
      appearance: DEFAULT_GENERAL_SETTINGS.appearance,
      background: { available: false, revision: null }
    });

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.remoteTargetConnect, {
      executionTargetId: TARGET_ID,
      mode: 'manual',
      credentials: { method: 'password', password: 'memory-only' },
      rememberCredential: true
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.remoteTargetConnect, {
      executionTargetId: TARGET_ID,
      mode: 'remembered'
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.remoteTargetHelperDetails);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.remoteTargetHelperInstall);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.appearancePresentationGet);
  });

  it('validates remote lifecycle events before delivering them', () => {
    let eventListener: ((value: unknown) => void) | undefined;
    const listener = vi.fn();
    const api = createLumoraApi(vi.fn(), (channel, callback) => {
      if (channel === IPC_CHANNELS.remoteLifecycleEvent) {
        eventListener = callback;
      }
      return vi.fn();
    });

    api.onRemoteLifecycleEvent(listener);
    eventListener?.({
      executionTargetId: TARGET_ID,
      snapshot: lifecycleSnapshot
    });

    expect(listener).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      snapshot: lifecycleSnapshot
    });
    expect(() => eventListener?.({ type: 'updated' })).toThrow();
  });

  it('validates remote-window close requests and resolutions', async () => {
    let closeListener: ((value: unknown) => void) | undefined;
    const listener = vi.fn();
    const invoke = vi.fn().mockResolvedValue({ closed: true });
    const api = createLumoraApi(invoke, (channel, callback) => {
      if (channel === IPC_CHANNELS.remoteWindowCloseRequest) {
        closeListener = callback;
      }
      return vi.fn();
    });

    api.onRemoteWindowCloseRequest(listener);
    closeListener?.({ executionTargetId: TARGET_ID, activeTerminalCount: 2 });
    expect(listener).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      activeTerminalCount: 2
    });
    await expect(api.resolveRemoteWindowClose({ action: 'keep_running' }))
      .resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.remoteWindowCloseResolve,
      { action: 'keep_running' }
    );
  });

  it('rejects malformed requests before invoking IPC', async () => {
    const invoke = vi.fn();
    const api = createLumoraApi(invoke);

    await expect(api.connectRemoteTarget({
      executionTargetId: 'not-a-uuid',
      mode: 'automatic'
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
