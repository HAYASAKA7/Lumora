import { describe, expect, it, vi } from 'vitest';

import { createApplicationReleaseRuntime } from './application-release-runtime';

describe('application release runtime', () => {
  it('composes a migrated cache and closes idempotently', async () => {
    const runtime = createApplicationReleaseRuntime({
      databasePath: ':memory:',
      installedVersion: '0.3.5',
      source: {
        latestRelease: vi.fn().mockResolvedValue({
          version: '0.3.5',
          publishedAt: '2026-08-20T00:00:00.000Z',
          summary: '',
          url: 'https://github.com/HAYASAKA7/Lumora/releases/tag/v0.3.5'
        })
      },
      openExternal: vi.fn()
    });
    await expect(runtime.service.getStatus()).resolves.toMatchObject({
      state: 'current'
    });
    await runtime.close();
    await runtime.close();
  });
});
