import type { RuntimeSummary, SessionSummary } from '../shared/contracts';
import { providerDefinition } from '../shared/provider-definitions';

const RECENT_SESSION_LIMIT = 5;
const MAX_SESSION_LABEL_LENGTH = 64;

export interface TrayMenuItem {
  label?: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  submenu?: TrayMenuItem[];
  click?(): void;
}

interface TrayMenuState {
  windowVisible: boolean;
  runtimes: readonly RuntimeSummary[];
  sessions: readonly SessionSummary[];
  onToggleWindow(): void;
  onResumeSession(sessionId: string): void;
  onExit(): void;
}

function truncateLabel(value: string): string {
  if (value.length <= MAX_SESSION_LABEL_LENGTH) return value;
  return `${value.slice(0, MAX_SESSION_LABEL_LENGTH - 1).trimEnd()}…`;
}

function recentSessionItems(
  sessions: readonly SessionSummary[],
  runningSessionIds: ReadonlySet<string>,
  onResumeSession: (sessionId: string) => void
): TrayMenuItem[] {
  const recent = [...sessions]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RECENT_SESSION_LIMIT);

  if (recent.length === 0) {
    return [{ label: 'No recent sessions', enabled: false }];
  }

  return recent.map((session) => ({
    label: truncateLabel(
      `${session.title} · ${providerDefinition(session.provider).displayName}${
        runningSessionIds.has(session.id) ? ' · Running' : ''
      }`
    ),
    click: () => onResumeSession(session.id)
  }));
}

export function buildTrayMenuTemplate({
  windowVisible,
  runtimes,
  sessions,
  onToggleWindow,
  onResumeSession,
  onExit
}: TrayMenuState): TrayMenuItem[] {
  const runningAgents = runtimes.filter(
    ({ state }) => state === 'launching' || state === 'running'
  );
  const runningSessionIds = new Set(
    runningAgents.flatMap((runtime) =>
      runtime.sessionId === null ? [] : [runtime.sessionId]
    )
  );

  return [
    {
      label: windowVisible ? 'Hide Lumora' : 'Show Lumora',
      click: onToggleWindow
    },
    { type: 'separator' },
    { label: `Running agents: ${runningAgents.length}`, enabled: false },
    {
      label: 'Recent sessions',
      submenu: recentSessionItems(sessions, runningSessionIds, onResumeSession)
    },
    { type: 'separator' },
    { label: 'Exit Lumora', click: onExit }
  ];
}
