export interface AppearanceSections {
  themePacksExpanded: boolean;
  conversationExpanded: boolean;
  typographyExpanded: boolean;
  backgroundExpanded: boolean;
}

interface AppearanceSectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AppearanceSectionPreferenceHost {
  readonly localStorage: AppearanceSectionStorage;
}

const APPEARANCE_SECTION_STORAGE_KEY = 'lumora.ui.settings.appearance.v1';

/**
 * Everything starts open, so the page reads exactly as it did before anyone
 * collapses anything. The saved choice only ever narrows it from there.
 */
export function defaultAppearanceSections(): AppearanceSections {
  return {
    themePacksExpanded: true,
    conversationExpanded: true,
    typographyExpanded: true,
    backgroundExpanded: true
  };
}

function isAppearanceSections(value: unknown): value is AppearanceSections {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.themePacksExpanded === 'boolean' &&
    typeof candidate.conversationExpanded === 'boolean' &&
    typeof candidate.typographyExpanded === 'boolean' &&
    typeof candidate.backgroundExpanded === 'boolean'
  );
}

export function readAppearanceSections(
  host: AppearanceSectionPreferenceHost
): AppearanceSections {
  try {
    const stored = host.localStorage.getItem(APPEARANCE_SECTION_STORAGE_KEY);
    if (stored === null) return defaultAppearanceSections();
    const parsed: unknown = JSON.parse(stored);
    return isAppearanceSections(parsed) ? parsed : defaultAppearanceSections();
  } catch {
    return defaultAppearanceSections();
  }
}

export function writeAppearanceSections(
  host: AppearanceSectionPreferenceHost,
  sections: AppearanceSections
): void {
  try {
    host.localStorage.setItem(
      APPEARANCE_SECTION_STORAGE_KEY,
      JSON.stringify(sections)
    );
  } catch {
    // A blocked preference store must not interrupt the settings page.
  }
}
