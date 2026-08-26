import { describe, expect, it } from 'vitest';

import {
  StructuredSessionGuard,
  StructuredSessionGuardError
} from './structured-session-guard';

describe('StructuredSessionGuard', () => {
  it('prevents PTY and structured runtimes from owning the same native session', () => {
    const guard = new StructuredSessionGuard();
    guard.claim({
      ownerId: 'pty-1',
      runtimeKind: 'pty',
      providerId: 'codex',
      nativeSessionId: 'thread-1'
    });

    expect(() => guard.claim({
      ownerId: 'structured-1',
      runtimeKind: 'structured',
      providerId: 'codex',
      nativeSessionId: 'thread-1'
    })).toThrow(StructuredSessionGuardError);
    expect(guard.ownerOf('codex', 'thread-1')).toEqual({
      ownerId: 'pty-1',
      runtimeKind: 'pty'
    });
  });

  it('atomically reconciles a new session identity and rejects a collision', () => {
    const guard = new StructuredSessionGuard();
    guard.claim({
      ownerId: 'existing',
      runtimeKind: 'structured',
      providerId: 'claude',
      nativeSessionId: 'native-1'
    });
    guard.claim({
      ownerId: 'new-runtime',
      runtimeKind: 'structured',
      providerId: 'claude',
      nativeSessionId: null
    });

    expect(() => guard.assignNativeSessionId('new-runtime', 'native-1'))
      .toThrow('already active');
    expect(guard.ownerOf('claude', 'native-1')?.ownerId).toBe('existing');
    expect(guard.claimOf('new-runtime')).toMatchObject({ nativeSessionId: null });

    guard.assignNativeSessionId('new-runtime', 'native-2');
    expect(guard.ownerOf('claude', 'native-2')?.ownerId).toBe('new-runtime');
  });

  it('releases claims idempotently without releasing another owner', () => {
    const guard = new StructuredSessionGuard();
    guard.claim({
      ownerId: 'runtime-1',
      runtimeKind: 'structured',
      providerId: 'gemini',
      nativeSessionId: 'gemini-1'
    });

    guard.release('unknown');
    guard.release('runtime-1');
    guard.release('runtime-1');

    expect(guard.ownerOf('gemini', 'gemini-1')).toBeNull();
  });
});
