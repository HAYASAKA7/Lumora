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
  const launchStructured = options.structuredFailure === undefined
    ? vi.fn(async () => structuredRuntime)
    : vi.fn(async () => { throw options.structuredFailure; });
  const router = new AgentLaunchRouter({
    consumePreparedLaunch,
    startPty,
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
  return { router, consumePreparedLaunch, startPty, launchStructured };
}

describe('AgentLaunchRouter', () => {
  it('automatically starts a verified enabled resume through the structured host', async () => {
    const { router, startPty, launchStructured } = harness();

    await expect(router.start('launch-token')).resolves.toEqual({
      mode: 'structured',
      routeReason: 'verified',
      runtime: structuredRuntime
    });
    expect(launchStructured).toHaveBeenCalledWith({
      strategy: 'resume',
      providerId: 'codex',
      sessionId: 'session-1',
      startPrompt: 'Continue the implementation.'
    });
    expect(startPty).not.toHaveBeenCalled();
  });

  it('uses PTY when the structured preference is disabled', async () => {
    const { router, startPty, launchStructured } = harness({
      preferenceEnabled: false
    });

    await expect(router.start('launch-token')).resolves.toEqual({
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

    await expect(router.start('launch-token')).resolves.toEqual({
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

    await expect(router.start('launch-token')).resolves.toEqual({
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

    await expect(router.start('launch-token')).rejects.toBe(collision);
    expect(startPty).not.toHaveBeenCalled();
  });

  it('keeps native fork and handoff launches on PTY', async () => {
    const fork = { ...spec, strategy: 'fork' as const } as LaunchSpec;
    const { router, launchStructured } = harness({ launchSpec: fork });

    await expect(router.start('launch-token')).resolves.toMatchObject({
      mode: 'pty',
      routeReason: 'unsupported_launch'
    });
    expect(launchStructured).not.toHaveBeenCalled();
  });
});
