import { describe, expect, it } from 'vitest';

import { resolveRuntimeSessionMatches } from './runtime-session-matcher';

describe('resolveRuntimeSessionMatches', () => {
  it('resolves one unambiguous runtime session', () => {
    expect(
      resolveRuntimeSessionMatches([
        {
          runtimeId: 'runtime-a',
          candidates: [{ sessionId: 'session-a', nativeSessionId: 'native-a' }]
        }
      ])
    ).toEqual([
      {
        runtimeId: 'runtime-a',
        sessionId: 'session-a',
        nativeSessionId: 'native-a'
      }
    ]);
  });

  it('does not guess between indistinguishable concurrent sessions', () => {
    const candidates = [
      { sessionId: 'session-a', nativeSessionId: 'native-a' },
      { sessionId: 'session-b', nativeSessionId: 'native-b' }
    ];

    expect(
      resolveRuntimeSessionMatches([
        { runtimeId: 'runtime-a', candidates },
        { runtimeId: 'runtime-b', candidates }
      ])
    ).toEqual([]);
  });

  it('does not let two singleton runtimes claim the same session', () => {
    const candidate = {
      sessionId: 'session-a',
      nativeSessionId: 'native-a'
    };

    expect(
      resolveRuntimeSessionMatches([
        { runtimeId: 'runtime-a', candidates: [candidate] },
        { runtimeId: 'runtime-b', candidates: [candidate] }
      ])
    ).toEqual([]);
  });

  it('iteratively resolves forced matches without using list order', () => {
    const sessionA = {
      sessionId: 'session-a',
      nativeSessionId: 'native-a'
    };
    const sessionB = {
      sessionId: 'session-b',
      nativeSessionId: 'native-b'
    };

    expect(
      resolveRuntimeSessionMatches([
        { runtimeId: 'runtime-a', candidates: [sessionA, sessionB] },
        { runtimeId: 'runtime-b', candidates: [sessionB] }
      ])
    ).toEqual([
      {
        runtimeId: 'runtime-b',
        sessionId: 'session-b',
        nativeSessionId: 'native-b'
      },
      {
        runtimeId: 'runtime-a',
        sessionId: 'session-a',
        nativeSessionId: 'native-a'
      }
    ]);
  });
});
