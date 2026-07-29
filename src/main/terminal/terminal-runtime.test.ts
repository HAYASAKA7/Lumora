import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  type RuntimeSummary
} from '../../shared/contracts';
import {
  collectActiveTransferSessions,
  createTerminalRuntime
} from './terminal-runtime';

const testPlatform =
  process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';

describe('createTerminalRuntime', () => {
  it('reports linked and unresolved live transfer conflicts without lifecycle inference', () => {
    const runtime = (
      overrides: Partial<RuntimeSummary>
    ): RuntimeSummary => ({
      id: randomUUID(),
      displayName: 'Transfer runtime',
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending',
      provider: 'codex',
      workspaceId: 'b'.repeat(64),
      terminalProfileId: 'c'.repeat(64),
      launchHash: 'd'.repeat(64),
      state: 'running',
      pid: 10,
      createdAt: '2026-07-22T04:00:00.000Z',
      startedAt: '2026-07-22T04:00:00.000Z',
      endedAt: null,
      exitCode: null,
      errorCode: null,
      ...overrides
    });
    const linkedSessionId = 'a'.repeat(64);
    const result = collectActiveTransferSessions([
      runtime({
        strategy: 'resume',
        sessionId: linkedSessionId,
        nativeSessionId: 'native-linked',
        reconciliationState: 'not_required'
      }),
      runtime({ id: randomUUID(), state: 'launching', pid: null }),
      runtime({
        id: randomUUID(),
        provider: 'opencode',
        workspaceId: 'e'.repeat(64)
      }),
      runtime({
        id: randomUUID(),
        state: 'completed',
        endedAt: '2026-07-22T04:01:00.000Z',
        exitCode: 0,
        pid: null
      })
    ]);

    expect(result).toEqual({
      sessionIds: [linkedSessionId],
      unresolvedScopes: [
        { provider: 'codex', workspaceId: 'b'.repeat(64) },
        { provider: 'opencode', workspaceId: 'e'.repeat(64) }
      ]
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sessionIds)).toBe(true);
    expect(Object.isFrozen(result.unresolvedScopes[0])).toBe(true);
  });

  it('exposes persisted General settings through the runtime boundary', async () => {
    const onGeneralSettingsSaved = vi.fn();
    const handoffService = {
      reserve: vi.fn(),
      materialize: vi.fn(),
      cleanupExpired: vi.fn(async () => ({ removed: 0 }))
    };
    const runtime = await createTerminalRuntime({
      databasePath: ':memory:',
      platform: testPlatform,
      env: {},
      scanProviders: async () => ({
        scannedAt: '2026-07-22T04:00:00.000Z',
        providers: []
      }),
      sessionCatalogRegistry: {
        providers: () => [],
        get: () => null
      },
      handoffService,
      onGeneralSettingsSaved,
      clock: () => new Date('2026-07-22T04:00:00.000Z')
    });

    try {
      expect(runtime.activeTransferSessions()).toEqual({
        sessionIds: [],
        unresolvedScopes: []
      });
      expect(runtime.getGeneralSettings()).toEqual(DEFAULT_GENERAL_SETTINGS);
      expect(
        runtime.saveGeneralSettings({
          ...DEFAULT_GENERAL_SETTINGS,
          showInformationalNotices: false
        })
      ).toEqual({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      });
      expect(runtime.getGeneralSettings()).toEqual({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      });
      expect(onGeneralSettingsSaved).toHaveBeenCalledWith({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      });
      expect(handoffService.cleanupExpired).toHaveBeenCalledWith(30);
    } finally {
      runtime.close();
    }
  });
});
