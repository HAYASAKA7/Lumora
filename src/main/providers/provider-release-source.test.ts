import { describe, expect, it, vi } from 'vitest';

import {
  ProviderReleaseError,
  createProviderReleaseSource
} from './provider-release-source';

describe('createProviderReleaseSource', () => {
  it('reads validated versions from fixed provider package URLs', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      new Response(JSON.stringify({
        version: String(url).includes('openai') ? '1.2.3' : '2.3.4'
      }), { status: 200 })
    );
    const source = createProviderReleaseSource({ fetch });

    await expect(source.latestVersion('codex')).resolves.toBe('1.2.3');
    await expect(source.latestVersion('claude')).resolves.toBe('2.3.4');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://registry.npmjs.org/@openai%2Fcodex/latest',
      'https://registry.npmjs.org/@anthropic-ai%2Fclaude-code/latest'
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

  it.each([
    new Response('registry unavailable', { status: 503 }),
    new Response('{bad json', { status: 200 }),
    new Response(JSON.stringify({ version: '' }), { status: 200 }),
    new Response(JSON.stringify({ version: 'x'.repeat(300) }), { status: 200 }),
    new Response('x'.repeat(32 * 1024 + 1), { status: 200 })
  ])('rejects an unusable registry response', async (response) => {
    const source = createProviderReleaseSource({
      fetch: vi.fn(async () => response)
    });

    await expect(source.latestVersion('codex')).rejects.toBeInstanceOf(
      ProviderReleaseError
    );
  });

  it('aborts a release request after its timeout', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        })
    );
    const source = createProviderReleaseSource({ fetch, timeoutMs: 1 });

    await expect(source.latestVersion('claude')).rejects.toMatchObject({
      code: 'PROVIDER_RELEASE_UNAVAILABLE'
    });
  });
});
