import { describe, expect, it, vi } from 'vitest';

import { createApplicationReleaseService } from './application-release-service';

const release = {
  version: '0.3.6',
  publishedAt: '2026-08-20T00:00:00.000Z',
  summary: 'Safer release.',
  url: 'https://github.com/HAYASAKA7/Lumora/releases/tag/v0.3.6'
} as const;

describe('application release service', () => {
  it('uses a fresh cache and reports a newer release', async () => {
    const latestRelease = vi.fn();
    const service = createApplicationReleaseService({
      installedVersion: '0.3.5',
      clock: () => new Date('2026-08-20T06:00:00.000Z'),
      cache: {
        get: () => ({ checkedAt: '2026-08-20T00:00:00.000Z', release }),
        set: vi.fn()
      },
      source: { latestRelease },
      openExternal: vi.fn()
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'update_available', release
    });
    expect(latestRelease).not.toHaveBeenCalled();
  });

  it('coalesces stale checks and opens only the validated update URL', async () => {
    const latestRelease = vi.fn().mockResolvedValue(release);
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const service = createApplicationReleaseService({
      installedVersion: '0.3.5',
      clock: () => new Date('2026-08-20T13:00:00.000Z'),
      cache: { get: () => null, set: vi.fn() },
      source: { latestRelease },
      openExternal
    });
    await Promise.all([service.getStatus(), service.getStatus()]);
    expect(latestRelease).toHaveBeenCalledTimes(1);
    await expect(service.openAvailableRelease()).resolves.toEqual({ opened: true });
    expect(openExternal).toHaveBeenCalledWith(release.url);
  });

  it('fails closed when the release cannot be checked', async () => {
    const service = createApplicationReleaseService({
      installedVersion: '0.3.5',
      cache: { get: () => null, set: vi.fn() },
      source: { latestRelease: vi.fn().mockRejectedValue(new Error('offline')) },
      openExternal: vi.fn()
    });
    await expect(service.getStatus()).resolves.toEqual({
      state: 'unavailable', installedVersion: '0.3.5'
    });
  });
});
