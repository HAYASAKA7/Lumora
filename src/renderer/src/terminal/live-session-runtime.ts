import type { RuntimeSummary } from '../../../shared/contracts';

export function indexLiveSessionRuntimes(
  runtimes: readonly RuntimeSummary[]
): ReadonlyMap<string, RuntimeSummary> {
  const index = new Map<string, RuntimeSummary>();
  for (const runtime of runtimes) {
    if (
      runtime.sessionId === null ||
      (runtime.state !== 'launching' && runtime.state !== 'running') ||
      index.has(runtime.sessionId)
    ) {
      continue;
    }
    index.set(runtime.sessionId, runtime);
  }
  return index;
}
