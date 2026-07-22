import { describe, expect, it } from 'vitest';

import { DEFAULT_GENERAL_SETTINGS } from '../../shared/contracts';
import { createTerminalRuntime } from './terminal-runtime';

const testPlatform =
  process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';

describe('createTerminalRuntime', () => {
  it('exposes persisted General settings through the runtime boundary', async () => {
    const runtime = await createTerminalRuntime({
      databasePath: ':memory:',
      platform: testPlatform,
      env: {},
      scanProviders: async () => ({
        scannedAt: '2026-07-22T04:00:00.000Z',
        providers: []
      }),
      sessionCatalogRegistry: {
        providers: () => [],
        get: () => null
      },
      clock: () => new Date('2026-07-22T04:00:00.000Z')
    });

    try {
      expect(runtime.getGeneralSettings()).toEqual(DEFAULT_GENERAL_SETTINGS);
      expect(
        runtime.saveGeneralSettings({
          ...DEFAULT_GENERAL_SETTINGS,
          showInformationalNotices: false
        })
      ).toEqual({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      });
      expect(runtime.getGeneralSettings()).toEqual({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      });
    } finally {
      runtime.close();
    }
  });
});
