import { z } from 'zod';

import {
  STRUCTURED_AGENT_PROVIDER_IDS,
  type StructuredAgentProviderId
} from '../../../shared/agent/contracts';

const UsageFileSchema = z.object({
  version: z.literal(1),
  lastLaunchedAt: z.record(z.string(), z.iso.datetime())
});

function isStructuredProvider(value: string): value is StructuredAgentProviderId {
  return STRUCTURED_AGENT_PROVIDER_IDS.some((candidate) => candidate === value);
}

export interface UnifiedLaunchUsageStore {
  load(): Promise<void>;
  /** Notes that a provider opened in Unified UI now. */
  record(providerId: StructuredAgentProviderId): void;
  /** Providers opened within `maxAgeMs`, most recent first. */
  recentProviders(maxAgeMs: number, limit: number): StructuredAgentProviderId[];
  /** Waits for pending writes, for an orderly shutdown and for tests. */
  flush(): Promise<void>;
}

/**
 * When each provider was last opened in Unified UI. It decides which checks
 * are worth warming after startup, and holds nothing but provider ids and times.
 */
export function createUnifiedLaunchUsageStore({
  readFile,
  writeFile,
  clock = () => new Date()
}: {
  readFile(): Promise<string>;
  writeFile(data: string): Promise<void>;
  clock?: () => Date;
}): UnifiedLaunchUsageStore {
  const lastLaunchedAt = new Map<StructuredAgentProviderId, string>();
  let writing: Promise<void> = Promise.resolve();

  return {
    async load() {
      try {
        const parsed = UsageFileSchema.safeParse(JSON.parse(await readFile()));
        if (!parsed.success) return;
        for (const [providerId, launchedAt] of Object.entries(parsed.data.lastLaunchedAt)) {
          if (isStructuredProvider(providerId)) lastLaunchedAt.set(providerId, launchedAt);
        }
      } catch {
        // A missing or unreadable file only means there is nothing to warm yet.
      }
    },
    record(providerId) {
      lastLaunchedAt.set(providerId, clock().toISOString());
      const data = `${JSON.stringify({
        version: 1,
        lastLaunchedAt: Object.fromEntries(lastLaunchedAt)
      }, null, 2)}\n`;
      writing = writing.then(() => writeFile(data)).catch(() => undefined);
    },
    recentProviders(maxAgeMs, limit) {
      const cutoff = clock().getTime() - maxAgeMs;
      return [...lastLaunchedAt]
        .map(([providerId, launchedAt]) => [providerId, Date.parse(launchedAt)] as const)
        .filter(([, launchedAt]) => launchedAt >= cutoff)
        .sort((left, right) => right[1] - left[1])
        .slice(0, Math.max(0, limit))
        .map(([providerId]) => providerId);
    },
    flush() {
      return writing;
    }
  };
}

/**
 * After startup, checks the providers recently opened in Unified UI in the
 * background, one at a time, so their next launch has its answer ready. It
 * leaves every other provider alone. Returns a function that cancels it.
 */
export function scheduleUnifiedCapabilityWarmup({
  delayMs,
  providers,
  isEnabled,
  check
}: {
  delayMs: number;
  providers(): readonly StructuredAgentProviderId[];
  isEnabled(): boolean;
  check(providerId: StructuredAgentProviderId): Promise<unknown>;
}): () => void {
  let cancelled = false;
  const timer = setTimeout(() => {
    void (async () => {
      for (const providerId of providers()) {
        if (cancelled || !isEnabled()) return;
        try {
          await check(providerId);
        } catch {
          // A failing check is reported by the launch that needs it.
        }
      }
    })();
  }, delayMs);
  timer.unref?.();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
