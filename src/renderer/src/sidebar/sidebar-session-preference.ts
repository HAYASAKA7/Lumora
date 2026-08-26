export interface SidebarSessionSections {
  runningExpanded: boolean;
  recentExpanded: boolean;
}

interface SidebarSessionPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SidebarSessionPreferenceHost {
  readonly localStorage: SidebarSessionPreferenceStorage;
}

const SIDEBAR_SESSION_STORAGE_PREFIX = 'lumora.ui.sidebar.sessions.v1';

export function defaultSidebarSessionSections(): SidebarSessionSections {
  return {
    runningExpanded: true,
    recentExpanded: true
  };
}

function storageKey(scope: string): string {
  return `${SIDEBAR_SESSION_STORAGE_PREFIX}:${encodeURIComponent(scope)}`;
}

function isSidebarSessionSections(
  value: unknown
): value is SidebarSessionSections {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.runningExpanded === 'boolean' &&
    typeof candidate.recentExpanded === 'boolean'
  );
}

export function readSidebarSessionSections(
  host: SidebarSessionPreferenceHost,
  scope: string
): SidebarSessionSections {
  try {
    const stored = host.localStorage.getItem(storageKey(scope));
    if (stored === null) return defaultSidebarSessionSections();
    const parsed: unknown = JSON.parse(stored);
    return isSidebarSessionSections(parsed)
      ? parsed
      : defaultSidebarSessionSections();
  } catch {
    return defaultSidebarSessionSections();
  }
}

export function writeSidebarSessionSections(
  host: SidebarSessionPreferenceHost,
  scope: string,
  sections: SidebarSessionSections
): void {
  try {
    host.localStorage.setItem(storageKey(scope), JSON.stringify(sections));
  } catch {
    // A blocked preference store must not interrupt sidebar navigation.
  }
}
