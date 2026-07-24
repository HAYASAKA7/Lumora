export const SIDEBAR_EXPANSION_STORAGE_KEY =
  'lumora.ui.sidebar.expansion.v1';

interface SidebarPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SidebarPreferenceHost {
  readonly localStorage: SidebarPreferenceStorage;
}

export function readSidebarExpanded(
  host: SidebarPreferenceHost
): boolean {
  try {
    return (
      host.localStorage.getItem(SIDEBAR_EXPANSION_STORAGE_KEY) !==
      'collapsed'
    );
  } catch {
    return true;
  }
}

export function writeSidebarExpanded(
  host: SidebarPreferenceHost,
  expanded: boolean
): void {
  try {
    host.localStorage.setItem(
      SIDEBAR_EXPANSION_STORAGE_KEY,
      expanded ? 'expanded' : 'collapsed'
    );
  } catch {
    // A blocked preference store must not interrupt sidebar navigation.
  }
}
