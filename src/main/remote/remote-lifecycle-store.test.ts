import { describe, expect, it, vi } from 'vitest';

import type {
  RemoteDiscoverySnapshot,
  RemoteExecutionTargetId,
  RemoteSessionCatalog,
  RemoteTargetSummary
} from '../../shared/contracts';
import { createRemoteLifecycleStore } from './remote-lifecycle-store';

const TARGET_ID = '6a2eb841-cf42-4f29-a6ed-0bf220b34f72' as RemoteExecutionTargetId;

function summary(state: RemoteTargetSummary['target']['connectionState']): RemoteTargetSummary {
  return {
    target: {
      id: TARGET_ID,
      kind: 'remote',
      displayName: 'Build server',
      platform: 'linux',
      architecture: 'x64',
      connectionState: state,
      helperVersion: state === 'ready' ? '0.3.1' : null,
      protocolVersion: state === 'ready' ? 1 : null,
      capabilities: state === 'ready' ? ['provider-scan', 'session-scan', 'pty'] : [],
      lastConnectedAt: state === 'ready' ? '2026-08-11T01:00:00.000Z' : null,
      lastScannedAt: null
    },
    profile: {
      executionTargetId: TARGET_ID,
      displayName: 'Build server',
      route: 'direct',
      host: 'build.local',
      port: 22,
      username: 'worker',
      sshConfigHost: null,
      authentication: { method: 'agent' },
      verifiedHostFingerprint: `SHA256:${'A'.repeat(43)}`,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z'
    }
  };
}

function discovery(): RemoteDiscoverySnapshot {
  return {
    executionTargetId: TARGET_ID,
    scannedAt: '2026-08-11T01:01:00.000Z',
    environment: {
      checkedAt: '2026-08-11T01:01:00.000Z',
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
      scannedAt: '2026-08-11T01:01:00.000Z',
      providers: []
    }
  };
}

function catalog(): RemoteSessionCatalog {
  return {
    executionTargetId: TARGET_ID,
    scannedAt: '2026-08-11T01:02:00.000Z',
    sessions: [],
    providers: [],
    snapshot: {
      refreshedAt: '2026-08-11T01:02:00.000Z',
      workspaces: [],
      sessions: [],
      providerStatus: [],
      providerFacets: [],
      diagnostics: []
    }
  };
}

describe('remote lifecycle store', () => {
  it('publishes immutable summary and scan state changes', () => {
    let current = summary('offline');
    const listener = vi.fn();
    const store = createRemoteLifecycleStore({ getSummary: () => current });
    store.subscribe(listener);

    const generation = store.beginConnection(TARGET_ID);
    current = summary('ready');
    store.refreshSummary(TARGET_ID);
    store.beginDiscovery(TARGET_ID, generation);
    store.completeDiscovery(TARGET_ID, generation, discovery());
    store.beginCatalog(TARGET_ID, generation);
    store.completeCatalog(TARGET_ID, generation, catalog());
    store.setActiveTerminalCount(TARGET_ID, 2);

    expect(store.snapshot(TARGET_ID)).toMatchObject({
      generation,
      summary: { target: { connectionState: 'ready' } },
      discoveryState: 'ready',
      catalogState: 'ready',
      activeTerminalCount: 2
    });
    expect(listener).toHaveBeenCalled();
  });

  it('retains successful data while refreshing or failed', () => {
    const store = createRemoteLifecycleStore({ getSummary: () => summary('ready') });
    const generation = store.beginConnection(TARGET_ID);
    store.completeCatalog(TARGET_ID, generation, catalog());

    store.beginCatalog(TARGET_ID, generation);
    expect(store.snapshot(TARGET_ID)).toMatchObject({
      catalogState: 'refreshing',
      catalog: { executionTargetId: TARGET_ID }
    });

    store.failCatalog(TARGET_ID, generation);
    expect(store.snapshot(TARGET_ID)).toMatchObject({
      catalogState: 'error',
      catalog: { executionTargetId: TARGET_ID }
    });
  });

  it('ignores scan completion from an older connection generation', () => {
    const store = createRemoteLifecycleStore({ getSummary: () => summary('ready') });
    const oldGeneration = store.beginConnection(TARGET_ID);
    const currentGeneration = store.beginConnection(TARGET_ID);

    store.completeDiscovery(TARGET_ID, oldGeneration, discovery());

    expect(currentGeneration).toBeGreaterThan(oldGeneration);
    expect(store.snapshot(TARGET_ID).discovery).toBeNull();
  });

  it('isolates listener failures and removes subscriptions', () => {
    const store = createRemoteLifecycleStore({ getSummary: () => summary('ready') });
    const healthy = vi.fn();
    store.subscribe(() => {
      throw new Error('listener failed');
    });
    const unsubscribe = store.subscribe(healthy);

    store.refreshSummary(TARGET_ID);
    unsubscribe();
    store.refreshSummary(TARGET_ID);

    expect(healthy).toHaveBeenCalledTimes(1);
  });
});
