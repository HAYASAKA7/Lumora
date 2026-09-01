import { bench, describe } from 'vitest';

import type { ProviderId, ProviderScanResult } from '../../shared/contracts';
import { ProviderScanCoordinator } from './provider-scan-coordinator';

const providers: readonly ProviderId[] = [
  'codex',
  'claude',
  'gemini',
  'opencode',
  'cursor',
  'copilot',
  'qwen',
  'amp',
  'crush',
  'goose',
  'aider',
  'kimi'
];

const result: ProviderScanResult = {
  scannedAt: '2026-08-13T00:00:00.000Z',
  providers: []
};

describe('provider scan coordination', () => {
  bench('reuses one native scan across a sequential launch pipeline', async () => {
    let nativeScanCount = 0;
    const coordinator = new ProviderScanCoordinator(async () => {
      nativeScanCount += 1;
      await Promise.resolve();
      return result;
    });

    await coordinator.scan(providers);
    await coordinator.scan(providers);
    await coordinator.scan(providers);
    await coordinator.scan(providers);

    if (nativeScanCount !== 1) {
      throw new Error(
        `Expected one native scan for the launch pipeline, received ${nativeScanCount}.`
      );
    }
  });

  bench('coalesces a 500-request startup and refresh burst', async () => {
    let nativeScanCount = 0;
    const coordinator = new ProviderScanCoordinator(async () => {
      nativeScanCount += 1;
      await Promise.resolve();
      return result;
    });

    const initial = coordinator.scan(providers);
    const cachedReaders = Array.from(
      { length: 249 },
      () => coordinator.scan(providers)
    );
    const freshReaders = Array.from(
      { length: 250 },
      () => coordinator.scanFresh(providers)
    );

    await Promise.all([initial, ...cachedReaders, ...freshReaders]);
    if (nativeScanCount !== 2) {
      throw new Error(
        `Expected two native scans for the coalesced burst, received ${nativeScanCount}.`
      );
    }
  });
});
