import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react';

import type {
  KeyboardSettings,
  KeyboardShortcutChord,
  SystemInfo
} from '../../../shared/contracts';
import { DEFAULT_KEYBOARD_SETTINGS } from '../../../shared/contracts';
import {
  chordFromKeyboardEvent,
  formatShortcutChord,
  shortcutConflictMessage
} from '../keyboard/shortcut';

type ShortcutSettingKey = Exclude<keyof KeyboardSettings, 'version'>;

const SHORTCUT_ROWS = [
  {
    key: 'terminalSwitcher',
    label: 'Switch active terminal',
    description: 'Cycle through open terminals in most-recently-used order.',
    ariaLabel: 'Record terminal switcher shortcut'
  },
  {
    key: 'openTerminals',
    label: 'Open terminals',
    description: 'Return to a running terminal and focus its input.',
    ariaLabel: 'Record open terminals shortcut'
  },
  {
    key: 'toggleSidebar',
    label: 'Toggle sidebar',
    description: 'Expand or collapse the sidebar.',
    ariaLabel: 'Record toggle sidebar shortcut'
  },
  {
    key: 'openHome',
    label: 'Go to Home',
    description: 'Open the Home page.',
    ariaLabel: 'Record go to Home shortcut'
  },
  {
    key: 'openWorkspaces',
    label: 'Go to Workspaces',
    description: 'Open the Workspaces page.',
    ariaLabel: 'Record go to Workspaces shortcut'
  },
  {
    key: 'openSessions',
    label: 'Go to All Sessions',
    description: 'Open the complete session catalog.',
    ariaLabel: 'Record go to All Sessions shortcut'
  },
  {
    key: 'openProfiles',
    label: 'Go to Terminal Profiles',
    description: 'Open terminal profile settings.',
    ariaLabel: 'Record go to Terminal Profiles shortcut'
  },
  {
    key: 'openRemote',
    label: 'Go to Remote computers',
    description: 'Open remote computer connections.',
    ariaLabel: 'Record go to Remote computers shortcut'
  },
  {
    key: 'openSettings',
    label: 'Go to Settings',
    description: 'Open Lumora settings.',
    ariaLabel: 'Record go to Settings shortcut'
  }
] as const satisfies ReadonlyArray<{
  key: ShortcutSettingKey;
  label: string;
  description: string;
  ariaLabel: string;
}>;

function chordsMatch(
  left: KeyboardShortcutChord,
  right: KeyboardShortcutChord
): boolean {
  return left.code === right.code &&
    left.control === right.control &&
    left.alt === right.alt &&
    left.shift === right.shift &&
    left.meta === right.meta;
}

function duplicateShortcutRows(settings: KeyboardSettings): readonly [
  (typeof SHORTCUT_ROWS)[number],
  (typeof SHORTCUT_ROWS)[number]
] | null {
  for (let index = 0; index < SHORTCUT_ROWS.length; index += 1) {
    const left = SHORTCUT_ROWS[index]!;
    const right = SHORTCUT_ROWS.slice(index + 1).find((candidate) =>
      chordsMatch(settings[left.key], settings[candidate.key])
    );
    if (right !== undefined) return [left, right];
  }
  return null;
}

export function KeyboardShortcutsPanel({
  onChange,
  platform
}: {
  onChange?(settings: KeyboardSettings): void;
  platform: SystemInfo['platform'];
}): ReactNode {
  const [settings, setSettings] = useState<KeyboardSettings | null>(null);
  const [draft, setDraft] = useState<KeyboardSettings | null>(null);
  const [recording, setRecording] = useState<ShortcutSettingKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.lumora.getKeyboardSettings().then(
      (value) => {
        if (!active) return;
        setSettings(value);
        setDraft(value);
        onChange?.(value);
      },
      () => {
        if (!active) return;
        setError('Keyboard settings could not be loaded.');
      }
    );
    return () => {
      active = false;
    };
  }, [onChange]);

  const record = (
    key: ShortcutSettingKey,
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    if (recording !== key || draft === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') {
      setRecording(null);
      setError(null);
      return;
    }

    const chord = chordFromKeyboardEvent(event.nativeEvent);
    if (chord === null) return;
    const platformConflict = shortcutConflictMessage(chord, platform);
    if (platformConflict !== null) {
      setError(platformConflict);
      setNotice(null);
      return;
    }
    const duplicate = SHORTCUT_ROWS.find(
      (row) => row.key !== key && chordsMatch(draft[row.key], chord)
    );
    if (duplicate !== undefined) {
      setError(`That shortcut is already used by ${duplicate.label}.`);
      setNotice(null);
      return;
    }

    setDraft({ ...draft, [key]: chord });
    setRecording(null);
    setError(null);
    setNotice(null);
  };

  const persist = (next: KeyboardSettings, successNotice: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    void window.lumora.saveKeyboardSettings(next).then(
      (value) => {
        setSettings(value);
        setDraft(value);
        setSaving(false);
        setNotice(successNotice);
        onChange?.(value);
      },
      () => {
        setSaving(false);
        setError('The shortcuts could not be saved.');
      }
    );
  };

  const save = () => {
    if (settings === null || draft === null) return;
    const duplicate = duplicateShortcutRows(draft);
    if (duplicate !== null) {
      setError(
        `${duplicate[0].label} and ${duplicate[1].label} use the same shortcut.`
      );
      setNotice(null);
      return;
    }
    persist(draft, 'Shortcuts saved.');
  };

  const reset = () => {
    if (settings === null) return;
    persist(DEFAULT_KEYBOARD_SETTINGS, 'Shortcuts reset.');
  };

  return (
    <section className="catalog-panel keyboard-settings-panel">
      <header className="provider-panel-header">
        <div>
          <p className="card-label">Keyboard</p>
          <h2>Keyboard shortcuts</h2>
          <p>Customize terminal access, navigation, and sidebar controls.</p>
        </div>
      </header>

      {draft === null ? (
        <p className="provider-panel-state">Loading keyboard settings…</p>
      ) : (
        <>
          <div className="keyboard-shortcut-list">
            {SHORTCUT_ROWS.map((row) => (
              <div className="keyboard-shortcut-row" key={row.key}>
                <div>
                  <strong>{row.label}</strong>
                  <p>{row.description}</p>
                </div>
                <button
                  aria-label={row.ariaLabel}
                  aria-pressed={recording === row.key}
                  className={`shortcut-recorder${recording === row.key ? ' is-recording' : ''}`}
                  disabled={saving}
                  onClick={() => {
                    setRecording(row.key);
                    setError(null);
                    setNotice(null);
                  }}
                  onKeyDown={(event) => record(row.key, event)}
                  type="button"
                >
                  {recording === row.key
                    ? 'Press shortcut…'
                    : formatShortcutChord(draft[row.key], platform)}
                </button>
              </div>
            ))}
          </div>
          <div className="keyboard-shortcut-actions">
            <button
              className="secondary-button"
              disabled={saving || recording !== null}
              onClick={save}
              type="button"
            >
              {saving ? 'Saving…' : 'Save shortcut'}
            </button>
            <button
              className="secondary-button"
              disabled={saving || recording !== null}
              onClick={reset}
              type="button"
            >
              Reset to default
            </button>
          </div>
        </>
      )}

      {error === null ? null : <p className="keyboard-setting-error" role="alert">{error}</p>}
      {notice === null ? null : <p className="keyboard-setting-notice" role="status">{notice}</p>}
    </section>
  );
}
