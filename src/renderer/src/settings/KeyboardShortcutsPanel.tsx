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

export function KeyboardShortcutsPanel({
  onChange,
  platform
}: {
  onChange?(settings: KeyboardSettings): void;
  platform: SystemInfo['platform'];
}): ReactNode {
  const [settings, setSettings] = useState<KeyboardSettings | null>(null);
  const [draft, setDraft] = useState<KeyboardShortcutChord | null>(null);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.lumora.getKeyboardSettings().then(
      (value) => {
        if (!active) return;
        setSettings(value);
        setDraft(value.terminalSwitcher);
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

  const record = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') {
      setRecording(false);
      setError(null);
      return;
    }

    const chord = chordFromKeyboardEvent(event.nativeEvent);
    if (chord === null) return;
    const conflict = shortcutConflictMessage(chord, platform);
    if (conflict !== null) {
      setError(conflict);
      setNotice(null);
      return;
    }

    setDraft(chord);
    setRecording(false);
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
        setDraft(value.terminalSwitcher);
        setSaving(false);
        setNotice(successNotice);
        onChange?.(value);
      },
      () => {
        setSaving(false);
        setError('The shortcut could not be saved.');
      }
    );
  };

  const save = () => {
    if (settings === null || draft === null) return;
    persist({ ...settings, terminalSwitcher: draft }, 'Shortcut saved.');
  };

  const reset = () => {
    if (settings === null) return;
    persist(DEFAULT_KEYBOARD_SETTINGS, 'Shortcut reset.');
  };

  return (
    <section className="catalog-panel keyboard-settings-panel">
      <header className="provider-panel-header">
        <div>
          <p className="card-label">Keyboard</p>
          <h2>Keyboard shortcuts</h2>
          <p>Choose how Lumora opens the active-terminal switcher.</p>
        </div>
      </header>

      {draft === null ? (
        <p className="provider-panel-state">Loading keyboard settings…</p>
      ) : (
        <div className="keyboard-shortcut-row">
          <div>
            <strong>Switch active terminal</strong>
            <p>Press the shortcut repeatedly to move through open terminals.</p>
          </div>
          <button
            aria-label="Record terminal switcher shortcut"
            aria-pressed={recording}
            className={`shortcut-recorder${recording ? ' is-recording' : ''}`}
            onClick={() => {
              setRecording(true);
              setError(null);
              setNotice(null);
            }}
            onKeyDown={record}
            type="button"
          >
            {recording ? 'Press shortcut…' : formatShortcutChord(draft, platform)}
          </button>
          <button
            className="secondary-button"
            disabled={saving || recording}
            onClick={save}
            type="button"
          >
            {saving ? 'Saving…' : 'Save shortcut'}
          </button>
          <button
            className="secondary-button"
            disabled={saving || recording}
            onClick={reset}
            type="button"
          >
            Reset to default
          </button>
        </div>
      )}

      {error === null ? null : <p className="keyboard-setting-error" role="alert">{error}</p>}
      {notice === null ? null : <p className="keyboard-setting-notice" role="status">{notice}</p>}
    </section>
  );
}
