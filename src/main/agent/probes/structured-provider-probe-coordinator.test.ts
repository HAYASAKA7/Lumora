import { describe, expect, it, vi } from 'vitest';

import type { ProviderInstallation } from '../../../shared/contracts';
import type { StructuredProviderCapabilityReport } from '../../../shared/agent/provider-capabilities';
import {
  StructuredProviderProbeCoordinator,
  type ReadyStructuredProviderInstallation
} from './structured-provider-probe-coordinator';

function ready(
  provider: ReadyStructuredProviderInstallation['provider'],
  version = '1.0.0'
): ReadyStructuredProviderInstallation {
  return {
    provider,
    displayName: provider,
    state: 'ready',
    executablePath: `C:\\tools\\${provider}.cmd`,
    version,
    issue: null
  };
}

function missing(provider: ProviderInstallation['provider']): ProviderInstallation {
  return {
    provider,
    displayName: provider,
    state: 'not_found',
    executablePath: null,
    version: null,
    issue: {
      code: 'PROVIDER_NOT_FOUND',
      message: 'missing',
      recovery: 'install',
      retryable: true
    }
  };
}

function verified(
  installation: ReadyStructuredProviderInstallation
): StructuredProviderCapabilityReport {
  const integration = {
    codex: 'codex_app_server',
    claude: 'claude_agent_sdk',
    gemini: 'gemini_acp'
  } as const;
  return {
    providerId: installation.provider,
    integration: integration[installation.provider],
    checkedAt: '2026-08-26T12:00:00.000Z',
    version: installation.version,
    state: 'verified',
    capabilities: {
      newSession: true,
      resumeSession: true,
      history: true,
      streaming: true,
      toolActivity: true,
      approvals: true,
      cancellation: true,
      usage: true,
      attachments: true
    },
    issue: null
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('StructuredProviderProbeCoordinator', () => {
  it('reports unavailable providers without invoking a structured runtime', async () => {
    const probeReady = vi.fn();
    const coordinator = new StructuredProviderProbeCoordinator({
      probeReady,
      now: () => new Date('2026-08-26T12:00:00.000Z')
    });

    const reports = await coordinator.scan([
      missing('codex'),
      missing('claude'),
      missing('gemini')
    ]);

    expect(probeReady).not.toHaveBeenCalled();
    expect(reports.map(({ providerId, state }) => [providerId, state])).toEqual([
      ['codex', 'unavailable'],
      ['claude', 'unavailable'],
      ['gemini', 'unavailable']
    ]);
    expect(JSON.stringify(reports)).not.toContain('executablePath');
  });

  it('coalesces and caches identical installed provider probes', async () => {
    const pending = deferred<StructuredProviderCapabilityReport>();
    const installation = ready('codex', '0.149.1');
    const probeReady = vi.fn(() => pending.promise);
    const coordinator = new StructuredProviderProbeCoordinator({ probeReady });

    const first = coordinator.scan([installation]);
    const second = coordinator.scan([installation]);
    expect(probeReady).toHaveBeenCalledOnce();

    pending.resolve(verified(installation));
    await Promise.all([first, second]);
    await coordinator.scan([installation]);

    expect(probeReady).toHaveBeenCalledOnce();
  });

  it('invalidates cached evidence when executable path or version changes', async () => {
    const probeReady = vi.fn(async (installation: ReadyStructuredProviderInstallation) =>
      verified(installation)
    );
    const coordinator = new StructuredProviderProbeCoordinator({ probeReady });

    await coordinator.scan([ready('claude', '2.1.239')]);
    await coordinator.scan([ready('claude', '2.1.240')]);

    expect(probeReady).toHaveBeenCalledTimes(2);
  });

  it('isolates failures and timeouts while preserving provider order', async () => {
    const probeReady = vi.fn(
      async (installation: ReadyStructuredProviderInstallation) => {
        if (installation.provider === 'codex') throw new Error('broken');
        if (installation.provider === 'claude') {
          return new Promise<StructuredProviderCapabilityReport>(() => undefined);
        }
        return verified(installation);
      }
    );
    const coordinator = new StructuredProviderProbeCoordinator({
      probeReady,
      timeoutMs: 10,
      now: () => new Date('2026-08-26T12:00:00.000Z')
    });

    const reports = await coordinator.scan([
      ready('gemini'),
      ready('claude'),
      ready('codex')
    ]);

    expect(reports.map(({ providerId, state }) => [providerId, state])).toEqual([
      ['codex', 'failed'],
      ['claude', 'timed_out'],
      ['gemini', 'verified']
    ]);
  });
});
