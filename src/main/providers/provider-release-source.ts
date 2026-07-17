import type { ProviderId } from '../../shared/contracts';

type FetchResponse = Pick<Response, 'ok' | 'text'>;
type FetchRelease = (
  input: string,
  init: RequestInit
) => Promise<FetchResponse>;

const PACKAGE_URLS: Readonly<Record<ProviderId, string>> = Object.freeze({
  codex: 'https://registry.npmjs.org/@openai%2Fcodex/latest',
  claude: 'https://registry.npmjs.org/@anthropic-ai%2Fclaude-code/latest'
});

const MAX_RESPONSE_LENGTH = 32 * 1024;

export interface ProviderReleaseSource {
  latestVersion(provider: ProviderId): Promise<string>;
}

export class ProviderReleaseError extends Error {
  readonly code = 'PROVIDER_RELEASE_UNAVAILABLE';

  constructor() {
    super('The latest provider release could not be checked.');
    this.name = 'ProviderReleaseError';
  }
}

export function createProviderReleaseSource({
  fetch,
  timeoutMs = 8_000
}: {
  fetch: FetchRelease;
  timeoutMs?: number;
}): ProviderReleaseSource {
  return Object.freeze({
    async latestVersion(provider: ProviderId): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(PACKAGE_URLS[provider], {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: controller.signal
        });
        if (!response.ok) throw new ProviderReleaseError();

        const text = await response.text();
        if (text.length > MAX_RESPONSE_LENGTH) throw new ProviderReleaseError();

        const value: unknown = JSON.parse(text);
        if (
          typeof value !== 'object' ||
          value === null ||
          !Object.prototype.hasOwnProperty.call(value, 'version')
        ) {
          throw new ProviderReleaseError();
        }
        const version = (value as { version: unknown }).version;
        if (
          typeof version !== 'string' ||
          version.length === 0 ||
          version.length > 256
        ) {
          throw new ProviderReleaseError();
        }
        return version;
      } catch {
        throw new ProviderReleaseError();
      } finally {
        clearTimeout(timer);
      }
    }
  });
}
