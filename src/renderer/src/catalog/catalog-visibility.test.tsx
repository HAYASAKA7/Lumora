import { describe, expect, it } from 'vitest';

import type {
  CatalogSnapshot,
  ProviderScanResult,
  TerminalProfile,
  WorkspaceVisibilityPolicy
} from '../../../shared/contracts';
import { projectCatalogVisibility } from './catalog-visibility';

const WORKSPACE_A = 'a'.repeat(64);
const WORKSPACE_B = 'b'.repeat(64);
const WORKSPACE_C = 'c'.repeat(64);

const snapshot: CatalogSnapshot = {
  refreshedAt: '2026-08-12T04:00:00.000Z',
  workspaces: [
    {
      id: WORKSPACE_A,
      displayName: 'Lumora',
      canonicalPath: '/work/lumora',
      available: true,
      origin: 'manual',
      sessionCount: 2,
      providerCounts: { codex: 1, claude: 1 },
      lastActivityAt: '2026-08-12T03:00:00.000Z'
    },
    {
      id: WORKSPACE_B,
      displayName: 'Archive',
      canonicalPath: '/work/archive',
      available: true,
      origin: 'discovered',
      sessionCount: 1,
      providerCounts: { codex: 1 },
      lastActivityAt: '2026-08-12T02:00:00.000Z'
    },
    {
      id: WORKSPACE_C,
      displayName: 'Missing disk',
      canonicalPath: '/gone/missing',
      available: false,
      origin: 'discovered',
      sessionCount: 1,
      providerCounts: { codex: 1 },
      lastActivityAt: '2026-08-12T01:00:00.000Z'
    }
  ],
  sessions: [
    {
      id: '1'.repeat(64), nativeId: 'codex-a', provider: 'codex',
      workspaceId: WORKSPACE_A, title: 'Build visibility',
      createdAt: '2026-08-12T01:00:00.000Z',
      updatedAt: '2026-08-12T03:00:00.000Z', lifetimeTokens: 100,
      lifecycle: 'saved', sourceFreshness: 'current'
    },
    {
      id: '2'.repeat(64), nativeId: 'claude-a', provider: 'claude',
      workspaceId: WORKSPACE_A, title: 'Review renderer',
      createdAt: '2026-08-12T01:00:00.000Z',
      updatedAt: '2026-08-12T02:30:00.000Z', lifetimeTokens: null,
      lifecycle: 'saved', sourceFreshness: 'current'
    },
    {
      id: '3'.repeat(64), nativeId: 'codex-b', provider: 'codex',
      workspaceId: WORKSPACE_B, title: 'Archived task',
      createdAt: '2026-08-12T01:00:00.000Z',
      updatedAt: '2026-08-12T02:00:00.000Z', lifetimeTokens: null,
      lifecycle: 'saved', sourceFreshness: 'current'
    },
    {
      id: '4'.repeat(64), nativeId: 'codex-c', provider: 'codex',
      workspaceId: WORKSPACE_C, title: 'Missing workspace task',
      createdAt: '2026-08-12T01:00:00.000Z',
      updatedAt: '2026-08-12T01:00:00.000Z', lifetimeTokens: null,
      lifecycle: 'saved', sourceFreshness: 'stale'
    }
  ],
  providerStatus: [
    { provider: 'codex', state: 'ready', discoveredCount: 3, unchangedCount: 0, invalidCount: 0 },
    { provider: 'claude', state: 'ready', discoveredCount: 1, unchangedCount: 0, invalidCount: 0 }
  ],
  providerFacets: [
    { provider: 'codex', sessionCount: 3 },
    { provider: 'claude', sessionCount: 1 }
  ],
  diagnostics: []
};

const providerScan: ProviderScanResult = {
  scannedAt: snapshot.refreshedAt,
  providers: [
    {
      provider: 'codex', displayName: 'Codex', state: 'ready',
      executablePath: '/usr/bin/codex', version: '1.0.0', issue: null
    },
    {
      provider: 'claude', displayName: 'Claude Code', state: 'not_found',
      executablePath: null, version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND', message: 'Missing', recovery: 'Install',
        retryable: true
      }
    }
  ]
};

const profiles: TerminalProfile[] = [{
  id: 'f'.repeat(64), kind: 'detected', name: 'Bash', shellFamily: 'bash',
  executablePath: '/bin/bash', args: [], available: true, recommended: true
}];

const settings = {
  showUnavailableWorkspaces: true,
  showUnusableSessions: true
};

function policy(
  workspaceId: string,
  mode: WorkspaceVisibilityPolicy['mode']
): WorkspaceVisibilityPolicy {
  return { workspaceId, mode, updatedAt: '2026-08-12T04:00:00.000Z' };
}

describe('projectCatalogVisibility', () => {
  it('keeps sessions for workspace-only hiding and retains raw workspace context', () => {
    const result = projectCatalogVisibility({
      snapshot,
      policies: [policy(WORKSPACE_A, 'workspace_only')],
      settings,
      providerScan,
      profiles,
      query: { text: '', provider: null }
    });

    expect(result.snapshot.workspaces.map(({ id }) => id)).toEqual([
      WORKSPACE_B,
      WORKSPACE_C
    ]);
    expect(result.snapshot.sessions.map(({ workspaceId }) => workspaceId))
      .toContain(WORKSPACE_A);
    expect(result.workspaceById.get(WORKSPACE_A)?.displayName).toBe('Lumora');
    expect(result.hiddenWorkspaces).toEqual([{
      workspace: snapshot.workspaces[0],
      policy: policy(WORKSPACE_A, 'workspace_only')
    }]);
  });

  it('removes sessions when the workspace-and-sessions mode is selected', () => {
    const result = projectCatalogVisibility({
      snapshot,
      policies: [policy(WORKSPACE_B, 'workspace_and_sessions')],
      settings,
      providerScan,
      profiles,
      query: { text: '', provider: null }
    });

    expect(result.snapshot.workspaces.some(({ id }) => id === WORKSPACE_B)).toBe(false);
    expect(result.snapshot.sessions.some(({ workspaceId }) => workspaceId === WORKSPACE_B)).toBe(false);
    expect(result.snapshot.providerFacets).toEqual([
      { provider: 'codex', sessionCount: 1 },
      { provider: 'claude', sessionCount: 1 }
    ]);
  });

  it('filters unavailable workspaces and unusable sessions independently', () => {
    const result = projectCatalogVisibility({
      snapshot,
      policies: [],
      settings: {
        showUnavailableWorkspaces: false,
        showUnusableSessions: false
      },
      providerScan,
      profiles,
      query: { text: '', provider: null }
    });

    expect(result.snapshot.workspaces.map(({ id }) => id)).toEqual([
      WORKSPACE_A,
      WORKSPACE_B
    ]);
    expect(result.snapshot.sessions.map(({ id }) => id)).toEqual([
      '1'.repeat(64),
      '3'.repeat(64)
    ]);
  });

  it('applies text and provider search after visibility and recalculates counts', () => {
    const result = projectCatalogVisibility({
      snapshot,
      policies: [policy(WORKSPACE_B, 'workspace_and_sessions')],
      settings,
      providerScan,
      profiles,
      query: { text: 'lumora', provider: 'codex' }
    });

    expect(result.snapshot.sessions.map(({ title }) => title)).toEqual([
      'Build visibility'
    ]);
    expect(result.snapshot.workspaces[0]).toMatchObject({
      id: WORKSPACE_A,
      sessionCount: 2,
      providerCounts: { codex: 1, claude: 1 }
    });
  });

  it('fails open when policies are unavailable and never mutates the raw snapshot', () => {
    const original = structuredClone(snapshot);
    const result = projectCatalogVisibility({
      snapshot,
      policies: null,
      settings,
      providerScan,
      profiles,
      query: { text: '', provider: null }
    });

    expect(result.snapshot.workspaces).toHaveLength(snapshot.workspaces.length);
    expect(snapshot).toEqual(original);
  });

  it('projects a large catalog without quadratic work', () => {
    const workspaces = Array.from({ length: 100 }, (_, index) => ({
      ...snapshot.workspaces[0]!,
      id: index.toString(16).padStart(64, '0'),
      displayName: `Workspace ${index}`,
      canonicalPath: `/work/${index}`
    }));
    const sessions = Array.from({ length: 5_000 }, (_, index) => ({
      ...snapshot.sessions[0]!,
      id: (index + 1_000).toString(16).padStart(64, '0'),
      nativeId: `session-${index}`,
      workspaceId: workspaces[index % workspaces.length]!.id
    }));
    const startedAt = performance.now();

    const result = projectCatalogVisibility({
      snapshot: { ...snapshot, workspaces, sessions },
      policies: workspaces.slice(0, 10).map((workspace) =>
        policy(workspace.id, 'workspace_and_sessions')
      ),
      settings,
      providerScan,
      profiles,
      query: { text: '', provider: null }
    });

    expect(result.snapshot.sessions).toHaveLength(4_500);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});
