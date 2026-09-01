import { describe, expect, it, vi } from 'vitest';

import type {
  RuntimeSummary,
  StructuredAgentRuntimeSummary
} from '../../../shared/contracts';
import type {
  StructuredProviderCapabilityReport,
  StructuredProviderPreference
} from '../../../shared/agent/provider-capabilities';
import type { LaunchSpec } from '../../terminal/launch-service';
import { AgentLaunchRouter } from './agent-launch-router';

const spec = {
  strategy: 'resume',
  sessionId: 'session-1',
  provider: 'codex',
  workspaceId: 'workspace-1',
  startPrompt: 'Continue the implementation.',
  handoff: null,
  fork: null
} as unknown as LaunchSpec;

const ptyRuntime = { id: 'pty-runtime-1' } as RuntimeSummary;
const structuredRuntime = {
  connectionId: 'structured-runtime-1'
} as StructuredAgentRuntimeSummary;

function report(
  state: StructuredProviderCapabilityReport['state']
): StructuredProviderCapabilityReport {
  const base = {
    providerId: 'codex' as const,
    integration: 'codex_app_server' as const,
    checkedAt: '2026-08-27T00:00:00.000Z',
    version: '1.0.0'
  };
  return state === 'verified'
    ? {
        ...base,
        state,
        capabilities: {
          newSession: true,
          resumeSession: true,
          history: true,
          streaming: true,
          toolActivity: true,
          approvals: true,
          cancellation: true,
          usage: true,
          attachments: false
        },
        issue: null
      }
    : {
        ...base,
        state,
        capabilities: null,
        issue: {
          code: 'STRUCTURED_PROBE_FAILED',
          message: 'Probe failed.',
          recovery: 'Use the terminal route.',
          retryable: true
        }
      } as StructuredProviderCapabilityReport;
}

function harness(options: {
  capability?: StructuredProviderCapabilityReport;
  preferenceEnabled?: boolean;
  structuredFailure?: Error;
  launchSpec?: LaunchSpec;
} = {}) {
  const consumePreparedLaunch = vi.fn(async () => options.launchSpec ?? spec);
  const startPty = vi.fn(async () => ptyRuntime);
  const terminatePty = vi.fn(async () => undefined);
  const launchStructured = options.structuredFailure === undefined
    ? vi.fn(async () => structuredRuntime)
    : vi.fn(async () => { throw options.structuredFailure; });
  const router = new AgentLaunchRouter({
    consumePreparedLaunch,
    startPty,
    terminatePty,
    launchStructured,
    scanCapabilities: vi.fn(async () => [options.capability ?? report('verified')]),
    listPreferences: vi.fn(() => [{
      providerId: 'codex',
      useUnifiedWhenAvailable: options.preferenceEnabled ?? true,
      executablePathOverride: null
    }, {
      providerId: 'claude',
      useUnifiedWhenAvailable: true,
      executablePathOverride: null
    }, {
      providerId: 'gemini',
      useUnifiedWhenAvailable: true,
      executablePathOverride: null
    }] satisfies StructuredProviderPreference[])
  });
  return {
    router,
    consumePreparedLaunch,
    startPty,
    terminatePty,
    launchStructured
  };
}

describe('AgentLaunchRouter', () => {
  it('automatically starts a verified enabled resume through the structured host', async () => {
    const { router, startPty, launchStructured } = harness();

    await expect(router.start('operation-1', 'launch-token')).resolves.toEqual({
      mode: 'structured',
      routeReason: 'verified',
      runtime: structuredRuntime
    });
    expect(launchStructured).toHaveBeenCalledWith(
      {
        strategy: 'resume',
        providerId: 'codex',
        sessionId: 'session-1',
        startPrompt: 'Continue the implementation.'
      },
      expect.any(AbortSignal)
    );
    expect(startPty).not.toHaveBeenCalled();
  });

  it('uses PTY when the structured preference is disabled', async () => {
    const { router, startPty, launchStructured } = harness({
      preferenceEnabled: false
    });

    await expect(router.start('operation-1', 'launch-token')).resolves.toEqual({
      mode: 'pty',
      routeReason: 'disabled',
      runtime: ptyRuntime
    });
    expect(startPty).toHaveBeenCalledWith(spec);
    expect(launchStructured).not.toHaveBeenCalled();
  });

  it('uses PTY without attempting a structured resume the provider did not advertise', async () => {
    const capability = report('verified');
    if (capability.state !== 'verified') throw new Error('invalid test fixture');
    const { router, startPty, launchStructured } = harness({
      capability: {
        ...capability,
        capabilities: { ...capability.capabilities, resumeSession: false }
      }
    });

    await expect(router.start('operation-1', 'launch-token')).resolves.toEqual({
      mode: 'pty',
      routeReason: 'unsupported_launch',
      runtime: ptyRuntime
    });
    expect(startPty).toHaveBeenCalledWith(spec);
    expect(launchStructured).not.toHaveBeenCalled();
  });

  it('falls back to the already-validated PTY launch when structured startup fails', async () => {
    const { router, startPty } = harness({
      structuredFailure: new Error('provider startup failed')
    });

    await expect(router.start('operation-1', 'launch-token')).resolves.toEqual({
      mode: 'pty',
      routeReason: 'structured_failed',
      runtime: ptyRuntime
    });
    expect(startPty).toHaveBeenCalledWith(spec);
  });

  it('does not bypass the one-writer guard by falling back after an ownership collision', async () => {
    const collision = Object.assign(new Error('already active'), {
      code: 'STRUCTURED_RUNTIME_ALREADY_ACTIVE'
    });
    const { router, startPty } = harness({ structuredFailure: collision });

    await expect(router.start('operation-1', 'launch-token')).rejects.toBe(collision);
    expect(startPty).not.toHaveBeenCalled();
  });

  it('keeps native fork and handoff launches on PTY', async () => {
    const fork = { ...spec, strategy: 'fork' as const } as LaunchSpec;
    const { router, launchStructured } = harness({ launchSpec: fork });

    await expect(router.start('operation-1', 'launch-token')).resolves.toMatchObject({
      mode: 'pty',
      routeReason: 'unsupported_launch'
    });
    expect(launchStructured).not.toHaveBeenCalled();
  });

  it('cancels a structured launch without falling back to PTY', async () => {
    let release!: () => void;
    const launchStructured = vi.fn((
      _request: unknown,
      signal: AbortSignal
    ) => new Promise<StructuredAgentRuntimeSummary>((_resolve, reject) => {
      release = () => reject(Object.assign(new Error('cancelled'), {
        code: 'STRUCTURED_RUNTIME_START_CANCELLED'
      }));
      signal.addEventListener('abort', release, { once: true });
    }));
    const startPty = vi.fn(async () => ptyRuntime);
    const router = new AgentLaunchRouter({
      consumePreparedLaunch: vi.fn(async () => spec),
      startPty,
      terminatePty: vi.fn(async () => undefined),
      launchStructured,
      scanCapabilities: vi.fn(async () => [report('verified')]),
      listPreferences: vi.fn(() => [{
        providerId: 'codex' as const,
        useUnifiedWhenAvailable: true,
        executablePathOverride: null
      }])
    });

    const starting = router.start('operation-1', 'launch-token');
    await vi.waitFor(() => expect(launchStructured).toHaveBeenCalledOnce());
    await router.cancel('operation-1');

    await expect(starting).rejects.toMatchObject({
      code: 'AGENT_LAUNCH_CANCELLED'
    });
    expect(startPty).not.toHaveBeenCalled();
  });

  it('terminates a PTY that resolves after cancellation', async () => {
    let resolvePty!: (runtime: RuntimeSummary) => void;
    const startPty = vi.fn(() => new Promise<RuntimeSummary>((resolve) => {
      resolvePty = resolve;
    }));
    const terminatePty = vi.fn(async () => undefined);
    const router = new AgentLaunchRouter({
      consumePreparedLaunch: vi.fn(async () => ({
        ...spec,
        strategy: 'fork'
      } as LaunchSpec)),
      startPty,
      terminatePty,
      launchStructured: vi.fn(async () => structuredRuntime),
      scanCapabilities: vi.fn(async () => []),
      listPreferences: vi.fn(() => [])
    });

    const starting = router.start('operation-1', 'launch-token');
    await vi.waitFor(() => expect(startPty).toHaveBeenCalledOnce());
    const cancelling = router.cancel('operation-1');
    resolvePty(ptyRuntime);

    await cancelling;
    await expect(starting).rejects.toMatchObject({
      code: 'AGENT_LAUNCH_CANCELLED'
    });
    expect(terminatePty).toHaveBeenCalledWith(ptyRuntime.id);
  });
});
