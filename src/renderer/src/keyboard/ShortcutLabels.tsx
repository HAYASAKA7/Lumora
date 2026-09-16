import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { KeyboardSettings, SystemInfo } from '../../../shared/contracts';
import { formatShortcutChord } from './shortcut';

type ShortcutName = Exclude<keyof KeyboardSettings, 'version'>;

const ShortcutLabelsContext = createContext<Partial<Record<ShortcutName, string>>>({});

/**
 * The written form of each shortcut, for the tooltips on the buttons they
 * work. A control deep in the tree should not have to be handed the keyboard
 * settings and the platform to say "Ctrl + Shift + G" under its name.
 */
export function ShortcutLabelsProvider({
  children,
  keyboardSettings,
  platform
}: {
  children: ReactNode;
  keyboardSettings: KeyboardSettings;
  /** Null until the platform is known; labels stay absent until then. */
  platform: SystemInfo['platform'] | null;
}): ReactNode {
  const labels = useMemo(() => {
    if (platform === null) return {};
    const entries = Object.entries(keyboardSettings)
      .filter(([name]) => name !== 'version')
      .map(([name, chord]) => [
        name,
        formatShortcutChord(chord as KeyboardSettings['terminalSwitcher'], platform)
      ] as const);
    return Object.fromEntries(entries) as Partial<Record<ShortcutName, string>>;
  }, [keyboardSettings, platform]);

  return (
    <ShortcutLabelsContext.Provider value={labels}>
      {children}
    </ShortcutLabelsContext.Provider>
  );
}

/** Undefined where no window provides the labels, such as a test rendering one control. */
export function useShortcutLabel(name: ShortcutName): string | undefined {
  return useContext(ShortcutLabelsContext)[name];
}
