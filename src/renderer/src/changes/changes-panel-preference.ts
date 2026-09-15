export const CHANGES_PANEL_WIDTH_KEY = 'lumora.ui.changes-panel.width.v1';
export const CHANGES_PANEL_MIN_WIDTH = 320;
export const CHANGES_PANEL_DEFAULT_WIDTH = 480;

/** The largest share of the available width the panel may take. */
const MAX_WIDTH_SHARE = 0.7;

interface ChangesPanelPreferenceHost {
  readonly localStorage: Pick<Storage, 'getItem' | 'setItem'>;
}

export function clampPanelWidth(width: number, available: number): number {
  const max = Math.max(CHANGES_PANEL_MIN_WIDTH, Math.floor(available * MAX_WIDTH_SHARE));
  return Math.round(Math.min(max, Math.max(CHANGES_PANEL_MIN_WIDTH, width)));
}

export function readPanelWidth(host: ChangesPanelPreferenceHost): number {
  try {
    const stored = host.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY);
    if (stored === null || stored.trim() === '') return CHANGES_PANEL_DEFAULT_WIDTH;
    const width = Number(stored);
    return Number.isFinite(width) && width >= CHANGES_PANEL_MIN_WIDTH
      ? width
      : CHANGES_PANEL_DEFAULT_WIDTH;
  } catch {
    return CHANGES_PANEL_DEFAULT_WIDTH;
  }
}

export function writePanelWidth(host: ChangesPanelPreferenceHost, width: number): void {
  try {
    host.localStorage.setItem(CHANGES_PANEL_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // A blocked preference store must not interrupt resizing the panel.
  }
}
