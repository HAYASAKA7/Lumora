import type { RuntimeSummary, SessionSummary } from '../../../shared/contracts';

export const SIDEBAR_RECENT_SESSION_LIMIT = 30;

interface SidebarSessionProjectionInput {
  runtimes: readonly RuntimeSummary[];
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
  sessions
}: SidebarSessionProjectionInput): SidebarSessionProjection {
  const running = runtimes.filter(isLiveRuntime);
  const runningSessionIds = new Set(
    running.flatMap(({ sessionId }) => sessionId === null ? [] : [sessionId])
  );
  const recent = sessions
    .filter(({ id }) => !runningSessionIds.has(id))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, SIDEBAR_RECENT_SESSION_LIMIT);

  return { running, recent };
}
