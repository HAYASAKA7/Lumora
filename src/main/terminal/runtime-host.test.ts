import { describe, expect, it, vi } from 'vitest';

import type { RuntimeEvent, RuntimeSummary } from '../../shared/contracts';
import type { LaunchSpec } from './launch-service';
import {
  RuntimeHost,
  type PtyProcess,
  type PtySpawnOptions
} from './runtime-host';

const launchSpec: LaunchSpec = {
  displayName: 'New Codex session',
  strategy: 'new',
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

class FakePty implements PtyProcess {
  readonly pid = 4321;
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  killed = false;
  private killError: Error | null = null;
  private nativeExited = false;
  private dataListener: ((data: string) => void) | null = null;
  private exitListener: ((event: { exitCode: number }) => void) | null = null;

  write(data: string): void {
    if (this.nativeExited) {
      throw new Error('Cannot write to a pty that has already exited');
    }
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    if (this.nativeExited) {
      throw new Error('Cannot resize a pty that has already exited');
    }
    this.resizes.push([cols, rows]);
  }

  kill(): void {
    if (this.killError !== null) throw this.killError;
    this.killed = true;
  }

  onData(listener: (data: string) => void) {
    this.dataListener = listener;
    return { dispose: () => { this.dataListener = null; } };
  }

  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListener = listener;
    return { dispose: () => { this.exitListener = null; } };
  }

  rejectKill(error: Error): void {
    this.killError = error;
  }

  markNativeExit(): void {
    this.nativeExited = true;
  }

  emitData(data: string): void {
    this.dataListener?.(data);
  }

  emitExit(exitCode: number): void {
    this.exitListener?.({ exitCode });
  }
}

function harness(options: {
  spawnError?: Error;
  launch?: LaunchSpec & { command?: string | null };
  platform?: 'win32' | 'darwin' | 'linux';
  exitDuringWait?: number;
} = {}) {
  const pty = new FakePty();
  const stored: RuntimeSummary[] = [];
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
  const spawn = vi.fn((_options: PtySpawnOptions) => {
    if (options.spawnError !== undefined) throw options.spawnError;
    return pty;
  });
  const host = new RuntimeHost({
    repository,
    consumeLaunch: vi.fn(async () => options.launch ?? launchSpec),
    spawn,
    startReconciliation,
    platform: options.platform ?? 'linux',
    clock: () => new Date('2026-07-11T04:00:01.000Z'),
    createRuntimeId: () => '0198f8b6-18f3-7ca0-9f0f-123456789abc',
    wait: vi.fn(async () => {
      if (options.exitDuringWait !== undefined) {
        pty.emitExit(options.exitDuringWait);
      }
    })
  });
  return { host, pty, repository, spawn, startReconciliation };
}

describe('RuntimeHost', () => {
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

  it('bounds output events and the attach snapshot', async () => {
    const { host, pty } = harness();
    const events: RuntimeEvent[] = [];
    host.subscribe((event) => events.push(event));
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    pty.emitData('x'.repeat(1_100_000));

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

  it('sends Ctrl+C before force-killing a live PTY', async () => {
    const { host, pty } = harness();
    const runtime = await host.start('0198f8b6-18f3-7ca0-9f0f-123456789abc');

    await host.terminate(runtime.id);

    expect(pty.writes).toEqual(['\u0003']);
    expect(pty.killed).toBe(true);
  });
});
