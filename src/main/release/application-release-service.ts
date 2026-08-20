import {
  ApplicationReleaseStatusSchema,
  ExternalOpenResultSchema,
  type ApplicationReleaseMetadata,
  type ApplicationReleaseStatus,
  type ExternalOpenResult
} from '../../shared/contracts';
import type { ApplicationReleaseCacheValue } from '../storage/application-release-cache-repository';
import { compareStableApplicationVersions } from './application-version';

const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;

interface ReleaseCache {
  get(): ApplicationReleaseCacheValue | null;
  set(value: ApplicationReleaseCacheValue): void;
}

interface ReleaseSource {
  latestRelease(signal?: AbortSignal): Promise<ApplicationReleaseMetadata>;
}

export interface ApplicationReleaseService {
  getStatus(): Promise<ApplicationReleaseStatus>;
  warm(): Promise<void>;
  openAvailableRelease(): Promise<ExternalOpenResult>;
  close(): Promise<void>;
}

export function createApplicationReleaseService({
  installedVersion,
  clock = () => new Date(),
  cache,
  source,
  openExternal
}: {
  installedVersion: string;
  clock?: () => Date;
  cache: ReleaseCache;
  source: ReleaseSource;
  openExternal(url: string): Promise<unknown>;
}): ApplicationReleaseService {
  let inFlight: Promise<ApplicationReleaseStatus> | null = null;
  let availableRelease: ApplicationReleaseMetadata | null = null;
  let activeController: AbortController | null = null;
  let closed = false;

  const statusFor = (release: ApplicationReleaseMetadata): ApplicationReleaseStatus => {
    const comparison = compareStableApplicationVersions(
      release.version,
      installedVersion
    );
    if (comparison === null) {
      return { state: 'unavailable', installedVersion };
    }
    if (comparison > 0) {
      availableRelease = release;
      return ApplicationReleaseStatusSchema.parse({
        state: 'update_available', installedVersion, release
      });
    }
    availableRelease = null;
    return ApplicationReleaseStatusSchema.parse({
      state: 'current', installedVersion, latestVersion: release.version
    });
  };

  const check = async (): Promise<ApplicationReleaseStatus> => {
    if (closed) return { state: 'unavailable', installedVersion };
    const cached = cache.get();
    const checkedAt = cached === null ? Number.NaN : Date.parse(cached.checkedAt);
    if (cached !== null && Number.isFinite(checkedAt) &&
        clock().getTime() - checkedAt < CACHE_TTL_MS) {
      return statusFor(cached.release);
    }
    activeController = new AbortController();
    try {
      const release = await source.latestRelease(activeController.signal);
      cache.set({ checkedAt: clock().toISOString(), release });
      return statusFor(release);
    } catch {
      return cached === null
        ? { state: 'unavailable', installedVersion }
        : statusFor(cached.release);
    } finally {
      activeController = null;
    }
  };

  return {
    getStatus() {
      inFlight ??= check().finally(() => { inFlight = null; });
      return inFlight;
    },
    async warm() {
      await this.getStatus();
    },
    async openAvailableRelease() {
      if (availableRelease === null) {
        await this.getStatus();
      }
      if (availableRelease === null) {
        throw new Error('No newer validated Lumora release is available.');
      }
      await openExternal(availableRelease.url);
      return ExternalOpenResultSchema.parse({ opened: true });
    },
    async close() {
      if (closed) return;
      closed = true;
      activeController?.abort();
      await inFlight?.catch(() => undefined);
    }
  };
}
