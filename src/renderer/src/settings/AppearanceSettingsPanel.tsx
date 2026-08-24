import { useEffect, useRef, useState } from 'react';

import type {
  AppearanceBackgroundState,
  AppearanceSettings,
  GeneralSettings
} from '../../../shared/contracts';
import { SelectMenu } from '../ui/SelectMenu';
import { useLocalization } from '../localization/useLocalization';

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
    labelKey: 'settings.appearance.theme-lumora',
    descriptionKey: 'settings.appearance.theme-lumora-description'
  },
  { id: 'light', labelKey: 'settings.appearance.theme-light', descriptionKey: 'settings.appearance.theme-light-description' },
  { id: 'dark', labelKey: 'settings.appearance.theme-dark', descriptionKey: 'settings.appearance.theme-dark-description' }
] as const satisfies ReadonlyArray<{
  id: AppearanceSettings['theme'];
  labelKey: string;
  descriptionKey: string;
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
  const { t } = useLocalization();
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
          <p className="card-label">{t('settings.appearance.eyebrow')}</p>
          <h2 id="appearance-settings-title">{t('settings.appearance.title')}</h2>
          <p>{t('settings.appearance.description')}</p>
        </div>
      </header>

      <fieldset className="appearance-theme-options" disabled={saving}>
        <legend>{t('settings.appearance.color-theme')}</legend>
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
              <strong>{t(option.labelKey)}</strong>
              <small>{t(option.descriptionKey)}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="general-setting-card">
        <span className="general-setting-copy">
          <strong>{t('settings.appearance.light-terminal')}</strong>
          <span id="appearance-light-terminal-description">
            {t('settings.appearance.light-terminal-description')}
          </span>
        </span>
        <span className="settings-switch">
          <input
            aria-describedby="appearance-light-terminal-description"
            aria-label={t('settings.appearance.light-terminal')}
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
            <p className="card-label">{t('settings.appearance.background')}</p>
            <h3 id="appearance-background-title">{t('settings.appearance.background-title')}</h3>
            <p>{t('settings.appearance.background-description')}</p>
          </div>
          <div className="appearance-background-actions">
            <button
              className="secondary-button"
              disabled={backgroundBusy}
              onClick={onChooseBackground}
              type="button"
            >
              {t(background.available ? 'settings.appearance.replace-image' : 'settings.appearance.choose-image')}
            </button>
            {background.available ? (
              <button
                className="secondary-button"
                disabled={backgroundBusy}
                onClick={onRemoveBackground}
                type="button"
              >
                {t('common.actions.remove')}
              </button>
            ) : null}
          </div>
        </div>

        <label className="general-setting-card">
          <span className="general-setting-copy">
            <strong>{t('settings.appearance.show-background')}</strong>
            <span id="appearance-background-enabled-description">
              {t('settings.appearance.show-background-description')}
            </span>
          </span>
          <span className="settings-switch">
            <input
              aria-describedby="appearance-background-enabled-description"
              aria-label={t('settings.appearance.show-background')}
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
            label={t('settings.appearance.image-opacity')}
            max={100}
            min={0}
            onChange={(value) => updateAppearance({ backgroundOpacity: value / 100 })}
            suffix="%"
            value={Math.round(settings.appearance.backgroundOpacity * 100)}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label={t('settings.appearance.image-brightness')}
            max={150}
            min={50}
            onChange={(value) => updateAppearance({ backgroundBrightness: value / 100 })}
            suffix="%"
            value={Math.round(settings.appearance.backgroundBrightness * 100)}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label={t('settings.appearance.image-blur')}
            max={24}
            min={0}
            onChange={(value) => updateAppearance({ backgroundBlur: value })}
            suffix=" px"
            value={settings.appearance.backgroundBlur}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label={t('settings.appearance.surface-mosaic')}
            max={24}
            min={0}
            onChange={(value) => updateAppearance({ surfaceMosaic: value })}
            suffix=" px"
            value={settings.appearance.surfaceMosaic}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label={t('settings.appearance.surface-opacity')}
            max={100}
            min={0}
            onChange={(value) => updateAppearance({ surfaceOpacity: value / 100 })}
            suffix="%"
            value={Math.round(settings.appearance.surfaceOpacity * 100)}
          />
          <AppearanceRange
            disabled={saving || !background.available}
            label={t('settings.appearance.terminal-opacity')}
            max={100}
            min={0}
            onChange={(value) => updateAppearance({ terminalOpacity: value / 100 })}
            suffix="%"
            value={Math.round(settings.appearance.terminalOpacity * 100)}
          />
          <div className="appearance-select-control">
            <span>{t('settings.appearance.image-fit')}</span>
            <SelectMenu
              disabled={saving || !background.available}
              label={t('settings.appearance.image-fit')}
              onChange={(value) => updateAppearance({
                backgroundFit: value as AppearanceSettings['backgroundFit']
              })}
              options={[
                { value: 'cover', label: t('settings.appearance.fit-cover') },
                { value: 'contain', label: t('settings.appearance.fit-contain') },
                { value: 'original', label: t('settings.appearance.fit-original') }
              ]}
              value={settings.appearance.backgroundFit}
            />
          </div>
          <div className="appearance-select-control">
            <span>{t('settings.appearance.image-position')}</span>
            <SelectMenu
              disabled={saving || !background.available}
              label={t('settings.appearance.image-position')}
              onChange={(value) => updateAppearance({
                backgroundPosition: value as AppearanceSettings['backgroundPosition']
              })}
              options={[
                { value: 'center', label: t('settings.appearance.position-center') },
                { value: 'top', label: t('settings.appearance.position-top') },
                { value: 'bottom', label: t('settings.appearance.position-bottom') },
                { value: 'left', label: t('settings.appearance.position-left') },
                { value: 'right', label: t('settings.appearance.position-right') },
                { value: 'top-left', label: t('settings.appearance.position-top-left') },
                { value: 'top-right', label: t('settings.appearance.position-top-right') },
                { value: 'bottom-left', label: t('settings.appearance.position-bottom-left') },
                { value: 'bottom-right', label: t('settings.appearance.position-bottom-right') }
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
