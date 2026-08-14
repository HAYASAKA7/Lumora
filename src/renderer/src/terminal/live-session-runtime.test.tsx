import { describe, expect, it } from 'vitest';

import type { RuntimeSummary } from '../../../shared/contracts';
import { indexLiveSessionRuntimes } from './live-session-runtime';

function runtime(
  id: string,
  state: RuntimeSummary['state'],
  sessionId: string | null
): RuntimeSummary {
  return {
    id,
    displayName: `Runtime ${id}`,
    strategy: sessionId === null ? 'new' : 'resume',
    sessionId,
    nativeSessionId: sessionId === null ? null : `native-${id}`,
    reconciliationState: sessionId === null ? 'pending' : 'not_required',
    provider: 'codex',
    workspaceId: 'a'.repeat(64),
    terminalProfileId: 'b'.repeat(64),
    launchHash: 'c'.repeat(64),
    state,
    pid: state === 'running' ? 1234 : null,
    createdAt: '2026-08-13T00:00:00.000Z',
    startedAt: state === 'running' ? '2026-08-13T00:00:01.000Z' : null,
    endedAt: state === 'completed' ? '2026-08-13T00:00:02.000Z' : null,
    exitCode: state === 'completed' ? 0 : null,
    errorCode: null
  };
}

describe('indexLiveSessionRuntimes', () => {
  it('indexes only linked launching and running runtimes', () => {
    const launchingSession = 'd'.repeat(64);
    const runningSession = 'e'.repeat(64);
    const completedSession = 'f'.repeat(64);

    const index = indexLiveSessionRuntimes([
      runtime('launching', 'launching', launchingSession),
      runtime('running', 'running', runningSession),
      runtime('unlinked', 'running', null),
      runtime('completed', 'completed', completedSession)
    ]);

    expect([...index.keys()]).toEqual([launchingSession, runningSession]);
    expect(index.get(runningSession)?.id).toBe('running');
  });

  it('uses the current reconciled association without guessing from titles', () => {
    const sessionId = 'd'.repeat(64);
    const before = runtime('new-runtime', 'running', null);
    const after = {
      ...before,
      sessionId,
      nativeSessionId: 'native-reconciled',
      reconciliationState: 'linked' as const
    };

    expect(indexLiveSessionRuntimes([before]).has(sessionId)).toBe(false);
    expect(indexLiveSessionRuntimes([after]).get(sessionId)?.id).toBe(
      'new-runtime'
    );
  });

  it('drops an association when the runtime is no longer live', () => {
    const sessionId = 'd'.repeat(64);

    expect(
      indexLiveSessionRuntimes([
        runtime('finished', 'completed', sessionId)
      ]).has(sessionId)
    ).toBe(false);
  });
});
