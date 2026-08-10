import { useEffect, useRef, useState } from 'react';

import type {
  AppearanceBackgroundState,
  AppearanceSettings,
  GeneralSettings
} from '../../../shared/contracts';
import { SelectMenu } from '../ui/SelectMenu';

interface AppearanceSettingsPanelProps {
  background: AppearanceBackgroundState;
  backgroundBusy: boolean;
  backgroundError: string | null;
  settings: GeneralSettings;
  saving: boolean;
  saveError: string | null;
  onChange(settings: GeneralSettings): void;
  onChooseBackground(): void;
  onRemoveBackground(): void;
}

const THEME_OPTIONS = [
  {
    id: 'lumora',
    label: 'Lumora mixed',
    description: 'Use Lumora’s original dark sidebar and light workspace.'
  },
  { id: 'light', label: 'Light', description: 'Use Lumora’s bright workspace.' },
  { id: 'dark', label: 'Dark', description: 'Use Lumora’s low-light workspace.' }
] as const satisfies ReadonlyArray<{
  id: AppearanceSettings['theme'];
  label: string;
  description: string;
}>;

export function AppearanceSettingsPanel({
  background,
  backgroundBusy,
  backgroundError,
  settings,
  saving,
  saveError,
  onChange,
  onChooseBackground,
  onRemoveBackground
}: AppearanceSettingsPanelProps) {
  const updateAppearance = (next: Partial<AppearanceSettings>) => {
    onChange({
      ...settings,
      appearance: { ...settings.appearance, ...next }
    });
  };

  return (
    <section
      aria-labelledby="appearance-settings-title"
      className="catalog-panel appearance-settings-panel"
    >
      <header className="provider-panel-header">
        <div>
          <p className="card-label">Personalization</p>
          <h2 id="appearance-settings-title">Appearance</h2>
          <p>Choose how Lumora and its managed terminals look.</p>
        </div>
      </header>

      <fieldset className="appearance-theme-options" disabled={saving}>
        <legend>Color theme</legend>
        {THEME_OPTIONS.map((option) => (
          <label className="appearance-theme-option" key={option.id}>
            <input
              checked={settings.appearance.theme === option.id}
              name="appearance-theme"
              onChange={() => updateAppearance({ theme: option.id })}
              type="radio"
              value={option.id}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="general-setting-card">
        <span className="general-setting-copy">
          <strong>Use a light terminal in Light mode</strong>
          <span id="appearance-light-terminal-description">
            Keep the familiar dark terminal unless this option is enabled.
          </span>
        </span>
        <span className="settings-switch">
          <input
            aria-describedby="appearance-light-terminal-description"
            aria-label="Use a light terminal in Light mode"
            checked={settings.appearance.lightTerminalInLightMode}
            disabled={saving}
            onChange={(event) => updateAppearance({
              lightTerminalInLightMode: event.currentTarget.checked
            })}
            role="switch"
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-switch-track">
            <span className="settings-switch-thumb" />
          </span>
        </span>
      </label>

      <section aria-labelledby="appearance-background-title" className="appearance-background-section">
        <div className="appearance-section-heading">
          <div>
            <p className="card-label">Custom background</p>
            <h3 id="appearance-background-title">Workspace image</h3>
            <p>Use one managed image behind every Lumora surface.</p>
          </div>
          <div className="appearance-background-actions">
            <button
              className="secondary-button"
              disabled={backgroundBusy}
              onClick={onChooseBackground}
              type="button"
            >
              {background.available ? 'Replace image' : 'Choose image'}
            </button>
            {background.available ? (
              <button
                className="secondary-button"
                disabled={backgroundBusy}
                onClick={onRemoveBackground}
                type="button"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>

        <label className="general-setting-card">
          <span className="general-setting-copy">
            <strong>Show custom background</strong>
            <span id="appearance-background-enabled-description">
              The original image stays untouched; Lumora uses a private managed copy.
            </span>
          </span>
          <span className="settings-switch">
            <input
              aria-describedby="appearance-background-enabled-description"
              aria-label="Show custom background"
              checked={settings.appearance.backgroundEnabled && background.available}
              disabled={saving || backgroundBusy || !background.available}
              onChange={(event) => updateAppearance({
                backgroundEnabled: event.currentTarget.checked
              })}
              role="switch"
              type="checkbox"
            />
            <span aria-hidden="true" className="settings-switch-track">
              <span className="settings-switch-thumb" />
            </span>
          </span>
        </label>

        <div className="appearance-control-grid">
          <AppearanceRange
            disabled={saving || !background.available}
            label="Image opacity"
            max={100}
            min={0}
            onChange={(value) => updateAppearance({ backgroundOpacity: value / 100 })}
            suffix="%"
            value={Math.round(settings.appearance.backgroundOpacity * 100)}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label="Image brightness"
            max={150}
            min={50}
            onChange={(value) => updateAppearance({ backgroundBrightness: value / 100 })}
            suffix="%"
            value={Math.round(settings.appearance.backgroundBrightness * 100)}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label="Image blur"
            max={24}
            min={0}
            onChange={(value) => updateAppearance({ backgroundBlur: value })}
            suffix=" px"
            value={settings.appearance.backgroundBlur}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label="Surface mosaic"
            max={24}
            min={0}
            onChange={(value) => updateAppearance({ surfaceMosaic: value })}
            suffix=" px"
            value={settings.appearance.surfaceMosaic}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label="Surface opacity"
            max={100}
            min={0}
            onChange={(value) => updateAppearance({ surfaceOpacity: value / 100 })}
            suffix="%"
            value={Math.round(settings.appearance.surfaceOpacity * 100)}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label="Terminal opacity"
            max={100}
            min={0}
            onChange={(value) => updateAppearance({ terminalOpacity: value / 100 })}
            suffix="%"
            value={Math.round(settings.appearance.terminalOpacity * 100)}
          />
          <div className="appearance-select-control">
            <span>Image fit</span>
            <SelectMenu
              disabled={saving || !background.available}
              label="Image fit"
              onChange={(value) => updateAppearance({
                backgroundFit: value as AppearanceSettings['backgroundFit']
              })}
              options={[
                { value: 'cover', label: 'Fill window' },
                { value: 'contain', label: 'Fit inside' },
                { value: 'original', label: 'Original size' }
              ]}
              value={settings.appearance.backgroundFit}
            />
          </div>
          <div className="appearance-select-control">
            <span>Image position</span>
            <SelectMenu
              disabled={saving || !background.available}
              label="Image position"
              onChange={(value) => updateAppearance({
                backgroundPosition: value as AppearanceSettings['backgroundPosition']
              })}
              options={[
                { value: 'center', label: 'Center' },
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
                { value: 'top-left', label: 'Top left' },
                { value: 'top-right', label: 'Top right' },
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'bottom-right', label: 'Bottom right' }
              ]}
              value={settings.appearance.backgroundPosition}
            />
          </div>
        </div>

        {backgroundError === null ? null : (
          <p className="general-setting-error" role="alert">{backgroundError}</p>
        )}
      </section>

      {saveError === null ? null : (
        <p className="general-setting-error" role="alert">{saveError}</p>
      )}
    </section>
  );
}

function AppearanceRange({
  disabled,
  label,
  max,
  min,
  onChange,
  suffix,
  value
}: {
  disabled: boolean;
  label: string;
  max: number;
  min: number;
  onChange(value: number): void;
  suffix: string;
  value: number;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const lastCommittedValue = useRef(value);

  useEffect(() => {
    setDraftValue(value);
    lastCommittedValue.current = value;
  }, [value]);

  const commitDraft = () => {
    if (draftValue === lastCommittedValue.current) {
      return;
    }

    lastCommittedValue.current = draftValue;
    onChange(draftValue);
  };

  return (
    <label className="appearance-range-control">
      <span><strong>{label}</strong><output>{draftValue}{suffix}</output></span>
      <input
        aria-label={label}
        disabled={disabled}
        max={max}
        min={min}
        onBlur={commitDraft}
        onChange={(event) => setDraftValue(Number(event.currentTarget.value))}
        onKeyUp={(event) => {
          if ([
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'End',
            'Home',
            'PageDown',
            'PageUp'
          ].includes(event.key)) {
            commitDraft();
          }
        }}
        onPointerUp={commitDraft}
        type="range"
        value={draftValue}
      />
    </label>
  );
}
