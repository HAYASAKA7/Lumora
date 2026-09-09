import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderInstallation,
  ProviderScanResult,
  StructuredProviderPreference
} from '../../../shared/contracts';
import { createStructuredCapabilityScan } from './structured-capability-scan';

function installation(
  provider: ProviderInstallation['provider']
): ProviderInstallation {
  return {
    provider,
    displayName: provider,
    state: 'ready',
    executablePath: `/usr/bin/${provider}`,
    version: '1.0.0',
    issue: null
  };
}

function scanResult(
  providers: readonly ProviderInstallation['provider'][]
): ProviderScanResult {
  return {
    scannedAt: '2026-09-09T07:30:00.000Z',
    providers: providers.map(installation)
  };
}

function preference(
  providerId: StructuredProviderPreference['providerId'],
  useUnifiedWhenAvailable: boolean
): StructuredProviderPreference {
  return {
    providerId,
    useUnifiedWhenAvailable,
    executablePathOverride: null
  };
}

function dependencies(overrides: {
  last?: ProviderScanResult | null;
  scan?: () => Promise<ProviderScanResult>;
  scanFresh?: () => Promise<ProviderScanResult>;
} = {}) {
  const scan = vi.fn(overrides.scan ?? (async () => scanResult(['codex'])));
  const scanFresh = vi.fn(
    overrides.scanFresh ?? (async () => scanResult(['codex']))
  );
  const probe = vi.fn(async (
    installations: readonly ProviderInstallation[]
  ) => installations.map((entry) => ({ providerId: entry.provider })));
  return {
    probe,
    scan,
    scanFresh,
    run: createStructuredCapabilityScan({
      lastScan: () => overrides.last ?? null,
      scan,
      scanFresh,
      resolveInstallations: async ({ scan: result }) => result.providers,
      probe: probe as never
    })
  };
}

describe('structured capability scan', () => {
  it('rides on the discovery the app already did', async () => {
    const deps = dependencies({ last: scanResult(['codex']) });

    await deps.run(false, [preference('codex', true)]);

    // Opening the interface list is not a reason to walk the filesystem: the
    // provider cards are already drawn from this very scan.
    expect(deps.scan).not.toHaveBeenCalled();
    expect(deps.scanFresh).not.toHaveBeenCalled();
  });

  it('discovers once when nothing has been scanned yet', async () => {
    const deps = dependencies({ last: null });

    await deps.run(false, [preference('codex', true)]);

    expect(deps.scan).toHaveBeenCalledOnce();
  });

  it('rediscovers when the check is explicitly asked to be fresh', async () => {
    const deps = dependencies({ last: scanResult(['codex']) });

    await deps.run(true, [preference('codex', true)]);

    expect(deps.scanFresh).toHaveBeenCalledOnce();
    expect(deps.scan).not.toHaveBeenCalled();
  });

  it('probes only the providers turned on for the unified interface', async () => {
    const deps = dependencies({ last: scanResult(['codex', 'claude', 'gemini']) });

    await deps.run(false, [
      preference('codex', true),
      preference('claude', false)
    ]);

    // Launching an agent CLI to ask what it supports is the expensive half of
    // this check, and a provider that will never route there does not need it.
    // A provider with no preference row yet keeps the enabled default.
    expect(deps.probe.mock.calls[0]?.[0].map((entry) => entry.provider))
      .toEqual(['codex', 'gemini']);
  });
});
