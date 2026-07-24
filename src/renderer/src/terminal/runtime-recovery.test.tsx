import { describe, expect, it } from 'vitest';

import type { RuntimeSummary, SessionSummary } from '../../../shared/contracts';
import { resolveRuntimeRecovery } from './runtime-recovery';

const runtime: RuntimeSummary = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  displayName: 'Repository cleanup',
  strategy: 'resume',
  sessionId: 'b'.repeat(64),
  nativeSessionId: 'native-thread',
  reconciliationState: 'not_required',
  provider: 'codex',
  workspaceId: 'a'.repeat(64),
  terminalProfileId: 'c'.repeat(64),
  launchHash: 'd'.repeat(64),
  state: 'runtime_lost',
  pid: null,
  createdAt: '2026-07-12T01:00:00.000Z',
  startedAt: '2026-07-12T01:00:01.000Z',
  endedAt: '2026-07-12T02:00:00.000Z',
  exitCode: null,
  errorCode: 'PTY_RUNTIME_LOST'
};

const session: SessionSummary = {
  id: runtime.sessionId!,
  nativeId: runtime.nativeSessionId!,
  provider: 'codex',
  workspaceId: runtime.workspaceId,
  title: 'Recovered work',
  createdAt: '2026-07-12T01:00:00.000Z',
  updatedAt: '2026-07-12T01:30:00.000Z',
  lifetimeTokens: null,
  lifecycle: 'saved',
  sourceFreshness: 'current'
};

describe('resolveRuntimeRecovery', () => {
  it('selects native resume only for the exact current catalog session', () => {
    expect(resolveRuntimeRecovery(runtime, [session])).toEqual({
      strategy: 'resume',
      session
    });
  });

  it('resumes a reconciled lost fork through its discovered native identity', () => {
    const reconciledFork = {
      ...runtime,
      strategy: 'fork' as const,
      displayName: 'Fork of Repository cleanup'
    };

    expect(resolveRuntimeRecovery(reconciledFork, [session])).toEqual({
      strategy: 'resume',
      session
    });
  });

  it('restarts an unreconciled lost fork as a fresh provider session', () => {
    const pendingFork = {
      ...runtime,
      strategy: 'fork' as const,
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending' as const
    };

    expect(resolveRuntimeRecovery(pendingFork, [session])).toEqual({
      strategy: 'new',
      provider: runtime.provider,
      workspaceId: runtime.workspaceId
    });
  });

  it.each([
    ['missing runtime link', { ...runtime, sessionId: null }, [session]],
    ['missing catalog row', runtime, []],
    ['stale catalog row', runtime, [{ ...session, sourceFreshness: 'stale' }]],
    ['provider mismatch', runtime, [{ ...session, provider: 'claude' }]],
    ['workspace mismatch', runtime, [{ ...session, workspaceId: 'e'.repeat(64) }]]
  ] as const)('selects a fresh restart for %s', (_name, candidate, sessions) => {
    expect(resolveRuntimeRecovery(candidate, sessions)).toEqual({
      strategy: 'new',
      provider: runtime.provider,
      workspaceId: runtime.workspaceId
    });
  });

  it('does not offer recovery for a runtime that is not lost', () => {
    expect(
      resolveRuntimeRecovery(
        { ...runtime, state: 'completed', errorCode: null },
        [session]
      )
    ).toBeNull();
  });
});
