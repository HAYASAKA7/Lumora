import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderScanResult,
  StructuredProviderPreference
} from '../../../shared/contracts';
import { resolveStructuredProviderInstallations } from './structured-provider-installations';

const scan: ProviderScanResult = {
  scannedAt: '2026-08-27T00:00:00.000Z',
  providers: [
    {
      provider: 'codex', displayName: 'Codex', state: 'ready',
      executablePath: 'C:\\tools\\codex.cmd', version: '1.0.0', issue: null
    },
    {
      provider: 'claude', displayName: 'Claude Code', state: 'ready',
      executablePath: 'C:\\tools\\claude.cmd', version: '2.1.0', issue: null
    },
    {
      provider: 'gemini', displayName: 'Gemini CLI', state: 'not_found',
      executablePath: null, version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND', message: 'Not found.', recovery: 'Install it.', retryable: true
      }
    }
  ]
};

const preferences: readonly StructuredProviderPreference[] = [
  { providerId: 'codex', useUnifiedWhenAvailable: true, executablePathOverride: 'D:\\apps\\codex.cmd' },
  { providerId: 'claude', useUnifiedWhenAvailable: true, executablePathOverride: null },
  { providerId: 'gemini', useUnifiedWhenAvailable: true, executablePathOverride: null }
];

describe('resolveStructuredProviderInstallations', () => {
  it('probes an independent structured executable override without changing the base scan', async () => {
    const probeVersion = vi.fn(async () => 'codex-cli 2.0.0');

    const resolved = await resolveStructuredProviderInstallations({
      scan,
      preferences,
      probeVersion
    });

    expect(probeVersion).toHaveBeenCalledWith('D:\\apps\\codex.cmd', ['--version']);
    expect(resolved.find(({ provider }) => provider === 'codex')).toMatchObject({
      state: 'ready', executablePath: 'D:\\apps\\codex.cmd', version: 'codex-cli 2.0.0'
    });
    expect(scan.providers[0]).toMatchObject({ executablePath: 'C:\\tools\\codex.cmd' });
  });

  it('returns a bounded probe failure for a broken override', async () => {
    const resolved = await resolveStructuredProviderInstallations({
      scan,
      preferences,
      probeVersion: vi.fn().mockRejectedValue(new Error('secret path output'))
    });

    expect(resolved.find(({ provider }) => provider === 'codex')).toMatchObject({
      state: 'probe_failed',
      executablePath: 'D:\\apps\\codex.cmd',
      issue: { code: 'PROVIDER_VERSION_PROBE_FAILED' }
    });
    expect(JSON.stringify(resolved)).not.toContain('secret path output');
  });
});
