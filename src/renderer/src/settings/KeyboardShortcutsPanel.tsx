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
import { useLocalization } from '../localization/useLocalization';

type ShortcutSettingKey = Exclude<keyof KeyboardSettings, 'version'>;

const SHORTCUT_ROWS = [
  {
    key: 'terminalSwitcher',
    labelKey: 'settings.shortcuts.switch-terminal',
    ariaActionKey: 'settings.shortcuts.terminal-switcher-action',
    descriptionKey: 'settings.shortcuts.switch-terminal-description'
  },
  {
    key: 'openTerminals',
    labelKey: 'settings.shortcuts.open-terminals',
    ariaActionKey: 'settings.shortcuts.open-terminals-action',
    descriptionKey: 'settings.shortcuts.open-terminals-description'
  },
  {
    key: 'toggleSidebar',
    labelKey: 'settings.shortcuts.toggle-sidebar',
    ariaActionKey: 'settings.shortcuts.toggle-sidebar-action',
    descriptionKey: 'settings.shortcuts.toggle-sidebar-description'
  },
  {
    key: 'openHome',
    labelKey: 'settings.shortcuts.open-home',
    ariaActionKey: 'settings.shortcuts.open-home-action',
    descriptionKey: 'settings.shortcuts.open-home-description'
  },
  {
    key: 'openWorkspaces',
    labelKey: 'settings.shortcuts.open-workspaces',
    ariaActionKey: 'settings.shortcuts.open-workspaces-action',
    descriptionKey: 'settings.shortcuts.open-workspaces-description'
  },
  {
    key: 'openSessions',
    labelKey: 'settings.shortcuts.open-sessions',
    ariaActionKey: 'settings.shortcuts.open-sessions-action',
    descriptionKey: 'settings.shortcuts.open-sessions-description'
  },
  {
    key: 'openProfiles',
    labelKey: 'settings.shortcuts.open-profiles',
    ariaActionKey: 'settings.shortcuts.open-profiles-action',
    descriptionKey: 'settings.shortcuts.open-profiles-description'
  },
  {
    key: 'openRemote',
    labelKey: 'settings.shortcuts.open-remote',
    ariaActionKey: 'settings.shortcuts.open-remote-action',
    descriptionKey: 'settings.shortcuts.open-remote-description'
  },
  {
    key: 'openSettings',
    labelKey: 'settings.shortcuts.open-settings',
    ariaActionKey: 'settings.shortcuts.open-settings-action',
    descriptionKey: 'settings.shortcuts.open-settings-description'
  }
] as const satisfies ReadonlyArray<{
  key: ShortcutSettingKey;
  labelKey: string;
  ariaActionKey: string;
  descriptionKey: string;
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
  const { t } = useLocalization();
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
        setError(t('settings.shortcuts.load-error'));
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
      setError(t('settings.shortcuts.windows-reserved'));
      setNotice(null);
      return;
    }
    const duplicate = SHORTCUT_ROWS.find(
      (row) => row.key !== key && chordsMatch(draft[row.key], chord)
    );
    if (duplicate !== undefined) {
      setError(t('settings.shortcuts.duplicate', { action: t(duplicate.labelKey) }));
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
        setError(t('settings.shortcuts.save-error'));
      }
    );
  };

  const save = () => {
    if (settings === null || draft === null) return;
    const duplicate = duplicateShortcutRows(draft);
    if (duplicate !== null) {
      setError(
        t('settings.shortcuts.duplicate-pair', {
          first: t(duplicate[0].labelKey),
          second: t(duplicate[1].labelKey)
        })
      );
      setNotice(null);
      return;
    }
    persist(draft, t('settings.shortcuts.saved'));
  };

  const reset = () => {
    if (settings === null) return;
    persist(DEFAULT_KEYBOARD_SETTINGS, t('settings.shortcuts.reset-complete'));
  };

  return (
    <section className="catalog-panel keyboard-settings-panel">
      <header className="provider-panel-header">
        <div>
          <p className="card-label">{t('settings.shortcuts.eyebrow')}</p>
          <h2>{t('settings.shortcuts.title')}</h2>
          <p>{t('settings.shortcuts.description')}</p>
        </div>
      </header>

      {draft === null ? (
        <p className="provider-panel-state">{t('settings.shortcuts.loading')}</p>
      ) : (
        <>
          <div className="keyboard-shortcut-list">
            {SHORTCUT_ROWS.map((row) => (
              <div className="keyboard-shortcut-row" key={row.key}>
                <div>
                  <strong>{t(row.labelKey)}</strong>
                  <p>{t(row.descriptionKey)}</p>
                </div>
                <button
                  aria-label={t('settings.shortcuts.record', { action: t(row.ariaActionKey) })}
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
                    ? t('settings.shortcuts.recording')
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
              {t(saving ? 'settings.shortcuts.saving' : 'settings.shortcuts.save')}
            </button>
            <button
              className="secondary-button"
              disabled={saving || recording !== null}
              onClick={reset}
              type="button"
            >
              {t('settings.shortcuts.reset-all')}
            </button>
          </div>
        </>
      )}

      {error === null ? null : <p className="keyboard-setting-error" role="alert">{error}</p>}
      {notice === null ? null : <p className="keyboard-setting-notice" role="status">{notice}</p>}
    </section>
  );
}
