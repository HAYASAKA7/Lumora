import type { StructuredAgentRuntimeSummary } from '../../../shared/agent/contracts';
import type { RuntimeSummary, SessionSummary } from '../../../shared/contracts';

interface SidebarSessionProjectionInput {
  runtimes: readonly RuntimeSummary[];
  /** Unified UI sessions, which run without a terminal runtime of their own. */
  structuredRuntimes?: readonly StructuredAgentRuntimeSummary[];
  sessions: readonly SessionSummary[];
}

export interface SidebarSessionProjection {
  running: readonly RuntimeSummary[];
  recent: readonly SessionSummary[];
}

function isLiveRuntime(runtime: RuntimeSummary): boolean {
  return runtime.state === 'launching' || runtime.state === 'running';
}

export function projectSidebarSessions({
  runtimes,
  structuredRuntimes = [],
  sessions
}: SidebarSessionProjectionInput): SidebarSessionProjection {
  const running = runtimes.filter(isLiveRuntime);
  // A session runs in a terminal or in the Unified UI; either way it is not recent.
  const runningSessionIds = new Set([
    ...running.flatMap(({ sessionId }) => sessionId === null ? [] : [sessionId]),
    ...structuredRuntimes.flatMap(({ catalogSessionId }) =>
      catalogSessionId === null ? [] : [catalogSessionId])
  ]);
  const recent = sessions
    .filter(({ id }) => !runningSessionIds.has(id))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return { running, recent };
}
