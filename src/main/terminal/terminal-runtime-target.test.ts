import { describe, expect, it, vi } from 'vitest';

import { createTerminalRuntime } from './terminal-runtime';

const remoteTargetId = '0198f8b6-18f3-7ca0-9f0f-123456789a00';

describe('createTerminalRuntime execution target binding', () => {
  it('rejects a runtime whose execution target is not persisted', async () => {
    const create = createTerminalRuntime({
      databasePath: ':memory:',
      executionTargetId: remoteTargetId,
      platform: process.platform === 'win32'
        ? 'win32'
        : process.platform === 'darwin'
          ? 'darwin'
          : 'linux',
      env: {},
      scanProviders: async () => ({
        scannedAt: '2026-08-04T10:00:00.000Z',
        providers: []
      }),
      sessionCatalogRegistry: {
        providers: () => [],
        get: () => null
      },
      handoffService: {
        reserve: vi.fn(),
        materialize: vi.fn(),
        cleanupExpired: vi.fn(async () => ({ removed: 0 }))
      },
      clock: () => new Date('2026-08-04T10:00:00.000Z')
    } as Parameters<typeof createTerminalRuntime>[0]);

    await expect(create).rejects.toThrow();
  });
});
