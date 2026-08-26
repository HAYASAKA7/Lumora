import { describe, expect, it, vi } from 'vitest';

import type { RuntimeEvent, RuntimeSummary } from '../../shared/contracts';
import type { LaunchSpec } from './launch-service';
import { StructuredSessionGuard } from '../agent/runtime/structured-session-guard';
import {
  PtyProcessExitedError,
  RuntimeHost,
  type PtyProcess,
  type PtySpawnOptions
} from './runtime-host';

const launchSpec: LaunchSpec = {
  displayName: 'New Codex session',
  strategy: 'new',
  startPrompt: '',
  sessionId: null,
  nativeSessionId: null,
  reconciliationBaselineNativeIds: ['known-native'],
  provider: 'codex',
  workspaceId: 'a'.repeat(64),
  executablePath: '/usr/local/bin/codex',
  args: [],
  command: null,
  workingDirectory: '/work/lumora',
  environment: { PATH: '/usr/local/bin', SHELL: '/bin/bash' },
  terminalProfile: {
    id: 'b'.repeat(64),
    kind: 'detected',
    name: 'Bash',
    shellFamily: 'bash',
    executablePath: '/bin/bash',
    args: [],
    available: true,
    recommended: true
  },
  configuration: [
    {
      field: 'providerCommand',
      value: null,
      winningSource: { scope: 'default', targetId: null },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    },
    {
      field: 'terminalProfile',
      value: 'b'.repeat(64),
      winningSource: { scope: 'launch', targetId: null },
      shadowed: [],
      mergeStrategy: 'replace',
      warnings: [],
      sensitive: false
    }
  ],
  launchHash: 'c'.repeat(64),
  cols: 80,
  rows: 24,
  createdAt: '2026-07-11T04:00:00.000Z'
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

class FakePty implements PtyProcess {
  constructor(readonly pid: number | null = 4321) {}
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  killed = false;
  killCount = 0;
  private killError: Error | null = null;
  private nativeExited = false;
  private operationError: Error | null = null;
  private dataListener: ((data: string) => void) | null = null;
  private exitListener: ((event: unknown) => void) | null = null;

  write(data: string): void {
    if (this.operationError !== null) throw this.operationError;
    if (this.nativeExited) {
      throw new PtyProcessExitedError();
    }
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    if (this.operationError !== null) throw this.operationError;
    if (this.nativeExited) {
      throw new PtyProcessExitedError();
    }
    this.resizes.push([cols, rows]);
  }

  kill(): void {
    if (this.killError !== null) throw this.killError;
    this.killed = true;
    this.killCount += 1;
  }

  onData(listener: (data: string) => void) {
    this.dataListener = listener;
    return { dispose: () => { this.dataListener = null; } };
  }

  onExit(listener: (event: unknown) => void) {
    this.exitListener = listener;
    return { dispose: () => { this.exitListener = null; } };
  }

  rejectKill(error: Error): void {
    this.killError = error;
  }

  rejectOperations(error: Error): void {
    this.operationError = error;
  }

  markNativeExit(): void {
    this.nativeExited = true;
  }

  emitData(data: string): void {
    this.dataListener?.(data);
  }

  emitExit(exitCode: unknown): void {
    this.exitListener?.({ exitCode });
  }

  emitRawExit(event: unknown): void {
    this.exitListener?.(event);
  }
}

function harness(options: {
  spawnError?: Error;
  launch?: LaunchSpec & { command?: string | null };
  launches?: readonly LaunchSpec[];
  platform?: 'win32' | 'darwin' | 'linux';
  exitDuringWait?: number;
  exitOnWaitCall?: number;
  exitOnWaitCode?: number;
  remote?: boolean;
  spawnGate?: Promise<PtyProcess>;
  persistedRuntimes?: readonly RuntimeSummary[];
  sessionGuard?: StructuredSessionGuard;
} = {}) {
  const pty = new FakePty(options.remote ? null : 4321);
  const ptys = [pty];
  const stored: RuntimeSummary[] = [...(options.persistedRuntimes ?? [])];
  const repository = {
    saveRuntime: vi.fn((runtime: RuntimeSummary) => {
      const index = stored.findIndex((item) => item.id === runtime.id);
      if (index === -1) stored.push(runtime);
      else stored[index] = runtime;
    }),
    listRuntimes: vi.fn(() => [...stored]),
    synchronizeRuntimeSessions: vi.fn((): RuntimeSummary[] => []),
    applyRuntimeReconciliation: vi.fn((runtimeId, result) => {
      const index = stored.findIndex((item) => item.id === runtimeId);
      const current = stored[index];
      if (current === undefined || current.reconciliationState !== 'pending') {
        return null;
      }
      const updated: RuntimeSummary = {
        ...current,
        reconciliationState: result.state,
        sessionId: result.state === 'linked' ? result.sessionId : null,
        nativeSessionId:
          result.state === 'linked' ? result.nativeSessionId : null
      };
      stored[index] = updated;
      return updated;
    })
  };
  const startReconciliation = vi.fn();
  let waitCallCount = 0;
  let spawnCount = 0;
  const spawn = vi.fn(async (_options: PtySpawnOptions) => {
    if (options.spawnError !== undefined) throw options.spawnError;
    if (options.spawnGate !== undefined) return options.spawnGate;
    const current = ptys[spawnCount] ?? new FakePty();
    if (ptys[spawnCount] === undefined) ptys.push(current);
    spawnCount += 1;
    return current;
  });
  let runtimeIdCount = 0;
  let launchCount = 0;
  const resolveInvocation = vi.fn(() => ({
    executablePath: launchSpec.executablePath,
    args: [...launchSpec.args],
    env: {}
  }));
  const host = new RuntimeHost({
    repository,
    consumeLaunch: vi.fn(async () =>
      options.launches?.[launchCount++] ?? options.launch ?? launchSpec
    ),
    spawn,
    startReconciliation,
    platform: options.platform ?? 'linux',
    ...(options.sessionGuard === undefined
      ? {}
      : { sessionGuard: options.sessionGuard }),
    ...(options.remote ? { resolveInvocation } : {}),
    clock: () => new Date('2026-07-11T04:00:01.000Z'),
    createRuntimeId: () => {
      const suffix = runtimeIdCount === 0 ? 'abc' : 'abd';
      runtimeIdCount += 1;
      return `0198f8b6-18f3-7ca0-9f0f-123456789${suffix}`;
    },
    wait: vi.fn(async () => {
      waitCallCount += 1;
      if (options.exitDuringWait !== undefined) {
        pty.emitExit(options.exitDuringWait);
      }
      if (options.exitOnWaitCall === waitCallCount) {
        pty.emitExit(options.exitOnWaitCode ?? 0);
      }
    })
  });
  return {
    host,
    pty,
    ptys,
    repository,
    spawn,
    startReconciliation,
    resolveInvocation
  };
}

describe('RuntimeHost', () => {
  it('starts an already-consumed launch specification without consuming another token', async () => {
    const { host, spawn } = harness();

    const runtime = await host.startPrepared(launchSpec);

    expect(runtime.state).toBe('running');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('shares native-session ownership with structured runtimes', async () => {
    const sessionGuard = new StructuredSessionGuard();
    sessionGuard.claim({
      ownerId: 'structured-connection',
      runtimeKind: 'structured',
      providerId: 'codex',
      nativeSessionId: 'native-thread-1'
    });
    const resumeLaunch: LaunchSpec = {
      ...launchSpec,
      displayName: 'Resume Codex session',
      strategy: 'resume',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1',
      reconciliationBaselineNativeIds: null
    };
    const { host, spawn } = harness({
      launch: resumeLaunch,
      sessionGuard
    });

    await expect(host.start('resume-token')).rejects.toMatchObject({
      code: 'RUNTIME_ALREADY_ACTIVE'
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('claims a new PTY native identity when reconciliation discovers it', async () => {
    const sessionGuard = new StructuredSessionGuard();
    const { host, pty } = harness({ sessionGuard });
    const runtime = await host.start('new-token');

    host.applyReconciliation(runtime.id, {
      state: 'linked',
      sessionId: 'e'.repeat(64),
      nativeSessionId: 'new-native-session'
    });

    expect(sessionGuard.ownerOf('codex', 'new-native-session')).toEqual({
      ownerId: runtime.id,
      runtimeKind: 'pty'
    });
    expect(() => sessionGuard.claim({
      ownerId: 'structured-duplicate',
      runtimeKind: 'structured',
      providerId: 'codex',
      nativeSessionId: 'new-native-session'
    })).toThrow('already active');

    pty.emitExit(0);
    expect(sessionGuard.ownerOf('codex', 'new-native-session')).toBeNull();
  });

  it('coalesces concurrent resume starts for the same linked session', async () => {
    const sessionId = 'd'.repeat(64);
    const spawnGate = deferred<PtyProcess>();
    const { host, pty, spawn } = harness({
      spawnGate: spawnGate.promise,
      launch: {
        ...launchSpec,
        strategy: 'resume',
        sessionId,
        nativeSessionId: 'native-thread-1',
        args: ['resume', 'native-thread-1']
      }
    });

    const first = host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const second = host.start('0198f8b6-18f3-7ca0-9f0f-123456789abd');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());

    spawnGate.resolve(pty);
    const [firstRuntime, secondRuntime] = await Promise.all([first, second]);

    expect(secondRuntime).toEqual(firstRuntime);
    expect(host.list()).toHaveLength(1);
  });

  it('returns an already-running runtime instead of resuming its session twice', async () => {
    const sessionId = 'd'.repeat(64);
    const { host, spawn } = harness({
      launch: {
        ...launchSpec,
        strategy: 'resume',
        sessionId,
        nativeSessionId: 'native-thread-1',
        args: ['resume', 'native-thread-1']
      }
    });

    const first = await host.start(
      '0198f8b6-18f3-7ca0-9f0f-123456789abc'
    );
    const second = await host.start(
      '0198f8b6-18f3-7ca0-9f0f-123456789abd'
    );

    expect(second).toEqual(first);
    expect(spawn).toHaveBeenCalledOnce();
    expect(host.list()).toHaveLength(1);
  });

  it('does not treat a persisted orphan runtime as active in this host', async () => {
    const sessionId = 'd'.repeat(64);
    const persisted: RuntimeSummary = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789999',
      displayName: 'Interrupted runtime',
      strategy: 'resume',
      sessionId,
      nativeSessionId: 'native-thread-1',
      reconciliationState: 'not_required',
      provider: 'codex',
      workspaceId: launchSpec.workspaceId,
      terminalProfileId: launchSpec.terminalProfile.id,
      launchHash: launchSpec.launchHash,
      state: 'running',
      pid: 41,
      createdAt: '2026-07-11T03:00:00.000Z',
      startedAt: '2026-07-11T03:00:01.000Z',
      endedAt: null,
      exitCode: null,
      errorCode: null
    };
    const { host, spawn } = harness({
      persistedRuntimes: [persisted],
      launch: {
        ...launchSpec,
        strategy: 'resume',
        sessionId,
        nativeSessionId: 'native-thread-1',
        args: ['resume', 'native-thread-1']
      }
    });

    const started = await host.start(
      '0198f8b6-18f3-7ca0-9f0f-123456789abc'
    );

    expect(started.id).not.toBe(persisted.id);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('guards a new runtime after reconciliation links its catalog session', async () => {
    const sessionId = 'd'.repeat(64);
    const resumeSpec: LaunchSpec = {
      ...launchSpec,
      displayName: 'Reconciled session',
      strategy: 'resume',
      sessionId,
      nativeSessionId: 'native-thread-1',
      reconciliationBaselineNativeIds: null,
      args: ['resume', 'native-thread-1']
    };
    const { host, spawn } = harness({
      launches: [launchSpec, resumeSpec]
    });

    const started = await host.start(
      '0198f8b6-18f3-7ca0-9f0f-123456789abc'
    );
    const linked = host.applyReconciliation(started.id, {
      state: 'linked',
      sessionId,
      nativeSessionId: 'native-thread-1'
    });
    const resumed = await host.start(
      '0198f8b6-18f3-7ca0-9f0f-123456789abd'
    );

    expect(linked).toMatchObject({ sessionId, state: 'running' });
    expect(resumed).toEqual(linked);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('awaits an asynchronous remote PTY and preserves its nullable pid', async () => {
    const { host, spawn, resolveInvocation } = harness({ remote: true });

    const runtime = await host.start(
      '0198f8b6-18f3-7ca0-9f0f-123456789abc'
    );

    expect(runtime.pid).toBeNull();
    expect(resolveInvocation).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith({
      executablePath: launchSpec.executablePath,
      args: launchSpec.args,
      env: {},
      cwd: launchSpec.workingDirectory,
      cols: launchSpec.cols,
      rows: launchSpec.rows
    });
  });

  it('persists launch transitions and forwards input and resize', async () => {
    const { host, pty, repository, spawn, startReconciliation } = harness();
    const events: RuntimeEvent[] = [];
    host.subscribe((event) => events.push(event));

    const runtime = await host.start(
      '0198f8b6-18f3-7ca0-9f0f-123456789abc'
    );
    host.write({ runtimeId: runtime.id, data: 'hello' });
    host.resize({ runtimeId: runtime.id, cols: 120, rows: 36 });

    expect(runtime).toMatchObject({
      displayName: 'New Codex session',
      state: 'running',
      pid: 4321,
      reconciliationState: 'pending'
    });
    expect(repository.saveRuntime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reconciliationState: 'pending' }),
      ['known-native']
    );
    expect(startReconciliation).toHaveBeenCalledWith({
      runtimeId: runtime.id,
      provider: 'codex',
      workspaceId: launchSpec.workspaceId,
      baselineNativeIds: ['known-native']
    });
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: '/bin/bash',
        args: ['-c', 'exec "$LUMORA_PROVIDER_EXECUTABLE"'],
        cwd: '/work/lumora',
        cols: 80,
        rows: 24
      })
    );
    expect(pty.writes).toEqual(['hello']);
    expect(pty.resizes).toEqual([[120, 36]]);
    expect(repository.saveRuntime).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === 'state')).toHaveLength(2);
  });

  it('starts a native fork unlinked and reconciles it as a new provider session', async () => {
    const forkLaunch: LaunchSpec = {
      ...launchSpec,
      displayName: 'Fork of Repository cleanup',
      strategy: 'fork',
      args: ['fork', 'native-thread-1', 'Fix the failing tests.'],
      fork: {
        sourceSessionId: 'd'.repeat(64),
        sourceNativeSessionId: 'native-thread-1',
        startPrompt: 'Fix the failing tests.'
      }
    };
    const { host, repository, startReconciliation } = harness({
      launch: forkLaunch
    });

    const runtime = await host.start(
      '0198f8b6-18f3-7ca0-9f0f-123456789abc'
    );

    expect(runtime).toMatchObject({
      displayName: 'Fork of Repository cleanup',
      strategy: 'fork',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending'
    });
    expect(repository.saveRuntime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ strategy: 'fork' }),
      ['known-native']
    );
    expect(repository.saveRuntime.mock.calls[0]?.[0]).not.toHaveProperty(
      'startPrompt'
    );
    expect(JSON.stringify(repository.saveRuntime.mock.calls)).not.toContain(
      'Fix the failing tests.'
    );
    expect(startReconciliation).toHaveBeenCalledWith({
      runtimeId: runtime.id,
      provider: 'codex',
      workspaceId: launchSpec.workspaceId,
      baselineNativeIds: ['known-native']
    });
  });

  it('copies resume identity into every runtime transition', async () => {
    const resumeLaunch: LaunchSpec = {
      ...launchSpec,
      displayName: 'Repository cleanup',
      strategy: 'resume',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1',
      reconciliationBaselineNativeIds: null,
      args: ['resume', 'native-thread-1']
    };
    const { host, repository } = harness({ launch: resumeLaunch });

    await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    expect(repository.saveRuntime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        displayName: 'Repository cleanup',
        strategy: 'resume',
        sessionId: 'd'.repeat(64),
        nativeSessionId: 'native-thread-1',
        reconciliationState: 'not_required',
        state: 'launching'
      })
    );
    expect(repository.saveRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        displayName: 'Repository cleanup',
        strategy: 'resume',
        sessionId: 'd'.repeat(64),
        nativeSessionId: 'native-thread-1',
        reconciliationState: 'not_required',
        state: 'running'
      })
    );
  });

  it('applies a unique reconciliation result to live and durable state', async () => {
    const { host, repository } = harness();
    const events: RuntimeEvent[] = [];
    host.subscribe((event) => events.push(event));
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    const linked = host.applyReconciliation(runtime.id, {
      state: 'linked',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1'
    });

    expect(linked).toMatchObject({
      reconciliationState: 'linked',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1'
    });
    expect(host.attach(runtime.id).runtime).toEqual(linked);
    expect(repository.applyRuntimeReconciliation).toHaveBeenCalledWith(
      runtime.id,
      expect.objectContaining({ state: 'linked' })
    );
    expect(events.at(-1)).toMatchObject({
      type: 'state',
      runtime: { reconciliationState: 'linked' }
    });
  });

  it('updates live runtime metadata and emits state after catalog synchronization', async () => {
    const { host, repository } = harness();
    const events: RuntimeEvent[] = [];
    host.subscribe((event) => events.push(event));
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    const linked: RuntimeSummary = {
      ...runtime,
      displayName: 'Renamed provider session',
      reconciliationState: 'linked',
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1'
    };
    repository.synchronizeRuntimeSessions.mockReturnValue([linked]);

    expect(host.synchronizeCatalogSessions()).toEqual([linked]);

    expect(host.attach(runtime.id).runtime).toEqual(linked);
    expect(events.at(-1)).toEqual({
      type: 'state',
      runtimeId: runtime.id,
      runtime: linked
    });
  });

  it('coalesces adjacent PTY output fragments before emitting them', async () => {
    const { host, pty } = harness();
    const events: RuntimeEvent[] = [];
    host.subscribe((event) => events.push(event));
    await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    pty.emitData('resume ');
    pty.emitData('history ');
    pty.emitData('ready');
    await Promise.resolve();

    expect(events.filter((event) => event.type === 'output')).toEqual([
      expect.objectContaining({
        type: 'output',
        sequence: 1,
        data: 'resume history ready'
      })
    ]);
  });

  it('bounds output events and the attach snapshot', async () => {
    const { host, pty } = harness();
    const events: RuntimeEvent[] = [];
    host.subscribe((event) => events.push(event));
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    pty.emitData('x'.repeat(1_100_000));
    await Promise.resolve();

    const outputEvents = events.filter((event) => event.type === 'output');
    expect(outputEvents.length).toBeGreaterThan(1);
    expect(outputEvents.every((event) => event.data.length <= 65_536)).toBe(true);
    expect(outputEvents.map((event) => event.sequence)).toEqual(
      outputEvents.map((_event, index) => index + 1)
    );
    expect(host.attach(runtime.id)).toMatchObject({
      snapshot: expect.any(String),
      outputSequence: outputEvents.length
    });
    expect(host.attach(runtime.id).snapshot).toHaveLength(1_048_576);
  });

  it('forwards the captured provider command to the shell adapter', async () => {
    const customLaunch = {
      ...launchSpec,
      strategy: 'resume' as const,
      sessionId: 'd'.repeat(64),
      nativeSessionId: 'native-thread-1',
      args: ['resume', 'native-thread-1'],
      command: 'codexp',
      terminalProfile: {
        ...launchSpec.terminalProfile,
        name: 'PowerShell 7',
        shellFamily: 'pwsh' as const,
        executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      }
    };
    const { host, spawn } = harness({
      launch: customLaunch,
      platform: 'win32'
    });

    await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        env: expect.objectContaining({
          LUMORA_PROVIDER_COMMAND: 'codexp',
          LUMORA_PROVIDER_ARGUMENTS: '["resume","native-thread-1"]'
        })
      })
    );
  });

  it('records normal and failed exits without retaining live handles', async () => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    pty.emitExit(7);

    expect(host.attach(runtime.id)).toMatchObject({
      outputSequence: 0,
      runtime: {
        state: 'failed',
        exitCode: 7,
        errorCode: 'PTY_RUNTIME_FAILED'
      }
    });
  });

  it.each([
    undefined,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '0',
    1.5
  ])('records an observed exit with invalid code %s', async (reportedExitCode) => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    expect(() =>
      pty.emitExit(reportedExitCode)
    ).not.toThrow();
    expect(host.attach(runtime.id).runtime).toMatchObject({
      id: runtime.id,
      state: 'completed',
      endedAt: '2026-07-11T04:00:01.000Z',
      exitCode: null,
      errorCode: null
    });
  });

  it('records an observed exit when the native event is malformed', async () => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    expect(() => pty.emitRawExit(null)).not.toThrow();
    expect(host.attach(runtime.id).runtime).toMatchObject({
      id: runtime.id,
      state: 'completed',
      exitCode: null,
      errorCode: null
    });
  });

  it('makes commands idempotent after a runtime exits', async () => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    pty.emitExit(0);

    expect(() =>
      host.write({ runtimeId: runtime.id, data: 'late' })
    ).not.toThrow();
    expect(() =>
      host.resize({ runtimeId: runtime.id, cols: 120, rows: 36 })
    ).not.toThrow();
    await expect(host.terminate(runtime.id)).resolves.toMatchObject({
      id: runtime.id,
      state: 'completed'
    });
    expect(pty.writes).toEqual([]);
    expect(pty.resizes).toEqual([]);
    expect(pty.killed).toBe(false);
  });

  it('continues rejecting commands for unknown runtime ids', () => {
    const { host } = harness();

    expect(() =>
      host.write({
        runtimeId: '0198f8b6-18f3-7ca0-9f0f-abcdef012345',
        data: 'invalid'
      })
    ).toThrowError('The terminal runtime was not found.');
  });

  it('absorbs native command failures while the exit callback is pending', async () => {
    const { host, pty } = harness({ exitDuringWait: 0 });
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    pty.markNativeExit();

    expect(() =>
      host.write({ runtimeId: runtime.id, data: 'late' })
    ).not.toThrow();
    expect(() =>
      host.resize({ runtimeId: runtime.id, cols: 120, rows: 36 })
    ).not.toThrow();
    await expect(host.terminate(runtime.id)).resolves.toMatchObject({
      id: runtime.id,
      state: 'completed',
      exitCode: 0
    });
    expect(pty.killed).toBe(false);
  });

  it('continues reporting unrelated live PTY operation failures', async () => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    pty.rejectOperations(new Error('live pty failed'));

    expect(() =>
      host.write({ runtimeId: runtime.id, data: 'input' })
    ).toThrow('live pty failed');
    expect(() =>
      host.resize({ runtimeId: runtime.id, cols: 120, rows: 36 })
    ).toThrow('live pty failed');
    expect(host.attach(runtime.id).runtime).toMatchObject({
      id: runtime.id,
      state: 'running'
    });
  });

  it('preserves a live runtime when force-kill fails', async () => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    pty.rejectKill(new Error('kill failed'));

    await expect(host.terminate(runtime.id)).rejects.toThrow('kill failed');

    expect(host.attach(runtime.id).runtime).toMatchObject({
      id: runtime.id,
      state: 'running'
    });
    expect(pty.killed).toBe(false);
  });

  it('normalizes spawn failures as launch_failed', async () => {
    const { host } = harness({
      spawnError: new Error('/secret/native failure'),
      launch: {
        ...launchSpec,
        strategy: 'resume',
        sessionId: 'd'.repeat(64),
        nativeSessionId: 'native-thread-1',
        args: ['resume', 'native-thread-1']
      }
    });

    await expect(
      host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc')
    ).rejects.toMatchObject({ code: 'PTY_SPAWN_FAILED' });
    expect(host.list()).toEqual([
      expect.objectContaining({
        strategy: 'resume',
        sessionId: 'd'.repeat(64),
        nativeSessionId: 'native-thread-1',
        state: 'launch_failed',
        errorCode: 'PTY_SPAWN_FAILED'
      })
    ]);
    expect(JSON.stringify(host.list())).not.toContain('/secret');
  });

  it('retries a graceful interrupt before force-killing a live PTY', async () => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    const stopped = await host.terminate(runtime.id);

    expect(pty.writes).toEqual(['\u0003', '\u0003']);
    expect(pty.killCount).toBe(1);
    expect(pty.killed).toBe(true);
    expect(stopped).toMatchObject({
      state: 'runtime_lost',
      errorCode: 'PTY_RUNTIME_LOST'
    });
  });

  it('uses the native exit observed after force-kill as the final outcome', async () => {
    const { host, pty } = harness({
      exitOnWaitCall: 3,
      exitOnWaitCode: 0
    });
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    const stopped = await host.terminate(runtime.id);

    expect(pty.writes).toEqual(['\u0003', '\u0003']);
    expect(pty.killCount).toBe(1);
    expect(stopped).toMatchObject({
      state: 'completed',
      exitCode: 0,
      errorCode: null
    });
  });

  it('coalesces concurrent termination requests into one shutdown sequence', async () => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    const [first, second] = await Promise.all([
      host.terminate(runtime.id),
      host.terminate(runtime.id)
    ]);

    expect(pty.writes).toEqual(['\u0003', '\u0003']);
    expect(pty.killCount).toBe(1);
    expect(first).toEqual(second);
  });

  it('waits for every live PTY shutdown sequence before resolving', async () => {
    const { host, ptys } = harness();
    await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abd');

    await host.shutdown();

    expect(ptys).toHaveLength(2);
    for (const current of ptys) {
      expect(current.writes).toEqual(['\u0003', '\u0003']);
      expect(current.killCount).toBe(1);
      expect(current.killed).toBe(true);
    }
    expect(host.list()).toEqual([
      expect.objectContaining({ state: 'runtime_lost' }),
      expect.objectContaining({ state: 'runtime_lost' })
    ]);
  });

  it('waits for a launch already spawning and then drains its PTY', async () => {
    const spawnGate = deferred<PtyProcess>();
    const { host, pty, spawn } = harness({ spawnGate: spawnGate.promise });
    const starting = host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());

    const shuttingDown = host.shutdown();
    spawnGate.resolve(pty);

    await expect(starting).resolves.toMatchObject({ state: 'running' });
    await expect(shuttingDown).resolves.toBeUndefined();
    expect(pty.writes).toEqual(['\u0003', '\u0003']);
    expect(pty.killCount).toBe(1);
    expect(host.list()).toEqual([
      expect.objectContaining({ state: 'runtime_lost' })
    ]);
  });

  it('coalesces shutdown and rejects launches after teardown starts', async () => {
    const { host, pty, spawn } = harness();
    await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    await Promise.all([host.shutdown(), host.shutdown()]);

    expect(pty.writes).toEqual(['\u0003', '\u0003']);
    expect(pty.killCount).toBe(1);
    await expect(
      host.start('0198f8b6-18f3-7ca0-9f0f-123456789abd')
    ).rejects.toMatchObject({ code: 'RUNTIME_SHUTTING_DOWN' });
    expect(spawn).toHaveBeenCalledOnce();
  });
});
