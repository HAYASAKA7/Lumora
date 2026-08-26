import { describe, expect, it } from 'vitest';

import type { RuntimeSummary, SessionSummary } from '../../../shared/contracts';
import { projectSidebarSessions } from './sidebar-sessions';

function runtime(
  idSuffix: string,
  state: RuntimeSummary['state'],
  sessionId: string | null
): RuntimeSummary {
  return {
    id: `0198f8b6-18f3-7ca0-9f0f-${idSuffix.padStart(12, '0')}`,
    displayName: `Runtime ${idSuffix}`,
    strategy: sessionId === null ? 'new' : 'resume',
    sessionId,
    nativeSessionId: sessionId === null ? null : `native-${idSuffix}`,
    reconciliationState: sessionId === null ? 'pending' : 'not_required',
    provider: 'codex',
    workspaceId: 'a'.repeat(64),
    terminalProfileId: 'b'.repeat(64),
    launchHash: idSuffix.repeat(64).slice(0, 64),
    state,
    pid: state === 'running' ? 1000 + Number(idSuffix) : null,
    createdAt: '2026-08-26T00:00:00.000Z',
    startedAt: '2026-08-26T00:00:01.000Z',
    endedAt: state === 'running' ? null : '2026-08-26T00:02:00.000Z',
    exitCode: state === 'completed' ? 0 : null,
    errorCode: null
  };
}

function session(index: number): SessionSummary {
  const value = index.toString(16).padStart(64, '0');
  return {
    id: value,
    nativeId: `native-${index}`,
    provider: 'codex',
    workspaceId: 'a'.repeat(64),
    title: `Session ${index}`,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
    lifetimeTokens: null,
    lifecycle: 'saved',
    sourceFreshness: 'current'
  };
}

describe('projectSidebarSessions', () => {
  it('keeps live runtime order and excludes completed runtimes', () => {
    const linkedSessionId = session(1).id;
    const values = [
      runtime('1', 'running', linkedSessionId),
      runtime('2', 'launching', null),
      runtime('3', 'completed', session(3).id)
    ];

    const result = projectSidebarSessions({ runtimes: values, sessions: [] });

    expect(result.running.map(({ id }) => id)).toEqual([
      values[0]!.id,
      values[1]!.id
    ]);
  });

  it('removes linked running sessions, sorts newest first, and keeps the full catalog', () => {
    const sessions = Array.from({ length: 35 }, (_, index) => session(index + 1));
    const linked = sessions[17]!;
    const shuffled = [...sessions].reverse().filter((_, index) => index % 2 === 0)
      .concat([...sessions].reverse().filter((_, index) => index % 2 === 1));

    const result = projectSidebarSessions({
      runtimes: [runtime('4', 'running', linked.id)],
      sessions: shuffled
    });

    expect(result.recent).toHaveLength(sessions.length - 1);
    expect(result.recent.some(({ id }) => id === linked.id)).toBe(false);
    expect(result.recent.map(({ updatedAt }) => updatedAt)).toEqual(
      [...result.recent]
        .map(({ updatedAt }) => updatedAt)
        .sort((left, right) => right.localeCompare(left))
    );
    expect(result.recent[0]?.title).toBe('Session 35');
  });

  it('does not mutate caller-owned arrays', () => {
    const sessions = [session(2), session(1)];
    const before = sessions.map(({ id }) => id);

    projectSidebarSessions({ runtimes: [], sessions });

    expect(sessions.map(({ id }) => id)).toEqual(before);
  });
});
