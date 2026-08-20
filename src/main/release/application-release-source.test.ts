import { describe, expect, it, vi } from 'vitest';

import { createApplicationReleaseSource } from './application-release-source';

const validPayload = {
  tag_name: 'v0.3.6',
  html_url: 'https://github.com/HAYASAKA7/Lumora/releases/tag/v0.3.6',
  published_at: '2026-08-20T00:00:00.000Z',
  body: '<b>Safer</b> release\nwith improvements.',
  draft: false,
  prerelease: false
};

describe('application release source', () => {
  it('requests and normalizes the latest stable Lumora release', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(validPayload)));
    const source = createApplicationReleaseSource({ fetch });

    await expect(source.latestRelease()).resolves.toEqual({
      version: '0.3.6',
      publishedAt: '2026-08-20T00:00:00.000Z',
      summary: 'Safer release with improvements.',
      url: validPayload.html_url
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/HAYASAKA7/Lumora/releases/latest',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/vnd.github+json' })
      })
    );
  });

  it.each([
    { ...validPayload, prerelease: true },
    { ...validPayload, draft: true },
    { ...validPayload, tag_name: 'v0.3.6-beta.1' },
    { ...validPayload, html_url: 'https://example.com/release' },
    { ...validPayload, html_url: `${validPayload.html_url}?download=1` }
  ])('rejects an unsafe or non-stable response', async (payload) => {
    const source = createApplicationReleaseSource({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
    });
    await expect(source.latestRelease()).rejects.toMatchObject({
      code: 'APPLICATION_RELEASE_UNAVAILABLE'
    });
  });

  it('rejects failed and oversized responses', async () => {
    const failed = createApplicationReleaseSource({
      fetch: vi.fn().mockResolvedValue(new Response('no', { status: 503 }))
    });
    await expect(failed.latestRelease()).rejects.toMatchObject({
      code: 'APPLICATION_RELEASE_UNAVAILABLE'
    });

    const oversized = createApplicationReleaseSource({
      fetch: vi.fn().mockResolvedValue(new Response('x'.repeat(262_145)))
    });
    await expect(oversized.latestRelease()).rejects.toMatchObject({
      code: 'APPLICATION_RELEASE_UNAVAILABLE'
    });
  });
});
