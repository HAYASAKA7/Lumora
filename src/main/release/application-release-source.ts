import { z } from 'zod';

import {
  ApplicationReleaseMetadataSchema,
  type ApplicationReleaseMetadata
} from '../../shared/contracts';

const ENDPOINT = 'https://api.github.com/repos/HAYASAKA7/Lumora/releases/latest';
const MAX_RESPONSE_BYTES = 256 * 1024;

const GithubReleaseSchema = z.strictObject({
  tag_name: z.string(),
  html_url: z.string(),
  published_at: z.iso.datetime(),
  body: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean()
});

export class ApplicationReleaseSourceError extends Error {
  readonly code = 'APPLICATION_RELEASE_UNAVAILABLE';

  constructor() {
    super('Lumora could not check the latest release.');
    this.name = 'ApplicationReleaseSourceError';
  }
}

function plainSummary(value: string | null): string {
  return (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[`*_>#\[\]()~-]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

export interface ApplicationReleaseSource {
  latestRelease(signal?: AbortSignal): Promise<ApplicationReleaseMetadata>;
}

export function createApplicationReleaseSource({
  fetch,
  timeoutMs = 8_000
}: {
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}): ApplicationReleaseSource {
  return {
    async latestRelease(signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        const response = await fetch(ENDPOINT, {
          signal: controller.signal,
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });
        if (!response.ok) throw new ApplicationReleaseSourceError();
        const declaredSize = Number(response.headers.get('content-length'));
        if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
          throw new ApplicationReleaseSourceError();
        }
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
          throw new ApplicationReleaseSourceError();
        }
        const payload = GithubReleaseSchema.parse(JSON.parse(text));
        if (payload.draft || payload.prerelease) {
          throw new ApplicationReleaseSourceError();
        }
        return ApplicationReleaseMetadataSchema.parse({
          version: payload.tag_name,
          publishedAt: payload.published_at,
          summary: plainSummary(payload.body),
          url: payload.html_url
        });
      } catch (error) {
        if (error instanceof ApplicationReleaseSourceError) throw error;
        throw new ApplicationReleaseSourceError();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
  };
}
