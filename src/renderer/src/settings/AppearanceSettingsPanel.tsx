import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AppearanceBackgroundState,
  AppearanceSettings,
  GeneralSettings,
  FontPreset,
  LumoraApi,
  ThemePresetList
} from '../../../shared/contracts';
import {
  MAXIMUM_TERMINAL_FONT_SIZE,
  MINIMUM_TERMINAL_FONT_SIZE
} from '../../../shared/contracts';
import { SelectMenu } from '../ui/SelectMenu';
import { useLocalization } from '../localization/useLocalization';
import {
  resolveInterfaceFontFamily,
  resolveTerminalFontFamily
} from '../appearance/font-family';

interface AppearanceSettingsPanelProps {
  active?: boolean;
  api?: Pick<LumoraApi, 'getFontPresets' | 'openThemePresetFolder'>;
  background: AppearanceBackgroundState;
  backgroundBusy: boolean;
  backgroundError: string | null;
  settings: GeneralSettings;
  saving: boolean;
  saveError: string | null;
  onChange(settings: GeneralSettings): void;
  onChooseBackground(): void;
  onRefreshThemePresets?(): void;
  onRemoveBackground(): void;
  themePresets?: ThemePresetList;
  themePresetsBusy?: boolean;
  themePresetsError?: boolean;
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

const EMPTY_THEME_PRESETS: ThemePresetList = {
  presets: [],
  rejectedCount: 0
};

function defaultUserMessageColor(theme: AppearanceSettings['theme']): string {
  return theme === 'dark' ? '#172D50' : '#E9F0FF';
}

export function AppearanceSettingsPanel({
  active = true,
  api = window.lumora,
  background,
  backgroundBusy,
  backgroundError,
  settings,
  saving,
  saveError,
  onChange,
  onChooseBackground,
  onRefreshThemePresets = () => undefined,
  onRemoveBackground,
  themePresets = EMPTY_THEME_PRESETS,
  themePresetsBusy = false,
  themePresetsError = false
}: AppearanceSettingsPanelProps) {
  const { t } = useLocalization();
  const [interfaceFontDraft, setInterfaceFontDraft] = useState(
    settings.appearance.interfaceFontFamily ?? ''
  );
  const [terminalFontDraft, setTerminalFontDraft] = useState(
    settings.appearance.terminalFontFamily ?? ''
  );
  const [fontPresets, setFontPresets] = useState<FontPreset[]>([]);
  const [fontPresetsBusy, setFontPresetsBusy] = useState(false);
  const [fontPresetsError, setFontPresetsError] = useState(false);
  const [rejectedFontPresets, setRejectedFontPresets] = useState(0);
  const [selectedFontPreset, setSelectedFontPreset] = useState('');
  const [selectedThemePreset, setSelectedThemePreset] = useState(
    settings.appearance.themePresetId ?? ''
  );
  const [themeFolderError, setThemeFolderError] = useState(false);
  const updateAppearance = (next: Partial<AppearanceSettings>) => {
    onChange({
      ...settings,
      appearance: { ...settings.appearance, ...next }
    });
  };

  useEffect(() => {
    setInterfaceFontDraft(settings.appearance.interfaceFontFamily ?? '');
    setTerminalFontDraft(settings.appearance.terminalFontFamily ?? '');
  }, [
    settings.appearance.interfaceFontFamily,
    settings.appearance.terminalFontFamily
  ]);

  useEffect(() => {
    const configured = settings.appearance.themePresetId;
    setSelectedThemePreset(
      configured !== null && themePresets.presets.some(({ id }) => id === configured)
        ? configured
        : ''
    );
  }, [settings.appearance.themePresetId, themePresets.presets]);

  const loadFontPresets = useCallback(async () => {
    setFontPresetsBusy(true);
    setFontPresetsError(false);
    try {
      const result = await api.getFontPresets();
      setFontPresets(result.presets);
      setRejectedFontPresets(result.rejectedCount);
      setSelectedFontPreset((current) =>
        result.presets.some((preset) => preset.id === current) ? current : ''
      );
    } catch {
      setFontPresetsError(true);
    } finally {
      setFontPresetsBusy(false);
    }
  }, [api]);

  useEffect(() => {
    if (active) void loadFontPresets();
  }, [active, loadFontPresets]);

  const commitFont = (
    key: 'interfaceFontFamily' | 'terminalFontFamily',
    draft: string
  ) => {
    const value = draft.trim() || null;
    if (settings.appearance[key] !== value) updateAppearance({ [key]: value });
  };
  const selectedTheme = themePresets.presets.find(
    ({ id }) => id === selectedThemePreset
  );

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
              checked={settings.appearance.themePresetId === null &&
                settings.appearance.theme === option.id}
              name="appearance-theme"
              onChange={() => updateAppearance({
                theme: option.id,
                themePresetId: null
              })}
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

      <section
        aria-labelledby="appearance-theme-packs-title"
        className="appearance-background-section appearance-theme-packs-section"
      >
        <div className="appearance-section-heading">
          <div>
            <p className="card-label">{t('settings.appearance.theme-packs')}</p>
            <h3 id="appearance-theme-packs-title">
              {t('settings.appearance.theme-packs-title')}
            </h3>
            <p>{t('settings.appearance.theme-packs-description')}</p>
          </div>
        </div>
        <div className="appearance-theme-pack-control">
          <div className="appearance-select-control">
            <span>{t('settings.appearance.theme-pack')}</span>
            <SelectMenu
              disabled={saving || themePresetsBusy}
              label={t('settings.appearance.theme-pack')}
              onChange={setSelectedThemePreset}
              options={[
                { value: '', label: t('settings.appearance.choose-theme-pack') },
                ...themePresets.presets.map((theme) => ({
                  value: theme.id,
                  label: theme.displayName
                }))
              ]}
              value={selectedThemePreset}
            />
          </div>
          {selectedTheme === undefined ? null : (() => {
            const preview = [
              selectedTheme.palette.sidebar,
              selectedTheme.palette.surface,
              selectedTheme.palette.surfaceRaised,
              selectedTheme.palette.accent,
              selectedTheme.palette.text
            ];
            return (
              <div
                aria-label={t('settings.appearance.theme-preview', {
                  theme: selectedTheme.displayName
                })}
                className="appearance-theme-preview"
              >
                {preview.map((color, index) => (
                  <span key={`${color}-${index}`} style={{ backgroundColor: color }} />
                ))}
              </div>
            );
          })()}
        </div>
        <div className="provider-panel-actions appearance-theme-pack-actions">
          <button
            className="secondary-button"
            data-lumora-command
            disabled={saving || selectedThemePreset === ''}
            onClick={() => {
              const selected = themePresets.presets.find(
                ({ id }) => id === selectedThemePreset
              );
              if (selected === undefined) return;
              updateAppearance({
                theme: selected.baseTheme,
                themePresetId: selected.id
              });
            }}
            tabIndex={-1}
            type="button"
          >
            {t('settings.appearance.apply-theme-pack')}
          </button>
          <button
            className="secondary-button"
            data-lumora-command
            disabled={themePresetsBusy}
            onClick={onRefreshThemePresets}
            tabIndex={-1}
            type="button"
          >
            {t('settings.appearance.reload-theme-packs')}
          </button>
          <button
            className="secondary-button"
            data-lumora-command
            disabled={themePresetsBusy}
            onClick={() => {
              setThemeFolderError(false);
              void api.openThemePresetFolder().catch(() => {
                setThemeFolderError(true);
              });
            }}
            tabIndex={-1}
            type="button"
          >
            {t('settings.appearance.open-theme-packs')}
          </button>
          <button
            className="secondary-button"
            data-lumora-command
            disabled={saving || settings.appearance.themePresetId === null}
            onClick={() => updateAppearance({
              theme: 'lumora',
              themePresetId: null
            })}
            tabIndex={-1}
            type="button"
          >
            {t('settings.appearance.reset-theme')}
          </button>
        </div>
        {themePresets.rejectedCount > 0 ? (
          <p className="general-setting-error" role="status">
            {t('settings.appearance.theme-packs-rejected', {
              count: themePresets.rejectedCount
            })}
          </p>
        ) : null}
        {settings.appearance.themePresetId !== null &&
        !themePresets.presets.some(({ id }) =>
          id === settings.appearance.themePresetId) ? (
          <p className="general-setting-error" role="status">
            {t('settings.appearance.theme-pack-missing')}
          </p>
        ) : null}
        {themePresetsError || themeFolderError ? (
          <p className="general-setting-error" role="alert">
            {t('settings.appearance.theme-packs-error')}
          </p>
        ) : null}
      </section>

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

      <section
        aria-labelledby="appearance-conversation-title"
        className="appearance-background-section appearance-conversation-section"
      >
        <div className="appearance-section-heading">
          <div>
            <p className="card-label">{t('settings.appearance.conversation')}</p>
            <h3 id="appearance-conversation-title">
              {t('settings.appearance.conversation-title')}
            </h3>
            <p>{t('settings.appearance.conversation-description')}</p>
          </div>
        </div>
        <div className="appearance-color-control">
          <label>
            <span>
              <strong>{t('settings.appearance.user-message-color')}</strong>
              <small>{t('settings.appearance.user-message-color-description')}</small>
            </span>
            <input
              aria-label={t('settings.appearance.user-message-color')}
              disabled={saving}
              onChange={(event) => updateAppearance({
                userMessageColor: event.currentTarget.value.toUpperCase()
              })}
              type="color"
              value={settings.appearance.userMessageColor ??
                defaultUserMessageColor(settings.appearance.theme)}
            />
          </label>
        </div>
        <div className="provider-panel-actions appearance-conversation-actions">
          <button
            className="secondary-button"
            data-lumora-command
            disabled={saving || settings.appearance.userMessageColor === null}
            onClick={() => updateAppearance({ userMessageColor: null })}
            type="button"
          >
            {t('settings.appearance.use-theme-message-color')}
          </button>
        </div>
      </section>

      <section aria-labelledby="appearance-typography-title" className="appearance-background-section appearance-typography-section">
        <div className="appearance-section-heading">
          <div>
            <p className="card-label">{t('settings.appearance.typography')}</p>
            <h3 id="appearance-typography-title">{t('settings.appearance.typography-title')}</h3>
            <p>{t('settings.appearance.typography-description')}</p>
          </div>
        </div>
        <div className="appearance-font-grid">
          <FontFamilyEditor
            description={t('settings.appearance.interface-font-description')}
            disabled={saving}
            draft={interfaceFontDraft}
            label={t('settings.appearance.interface-font')}
            onChange={setInterfaceFontDraft}
            onCommit={() => commitFont('interfaceFontFamily', interfaceFontDraft)}
            onReset={() => {
              setInterfaceFontDraft('');
              updateAppearance({ interfaceFontFamily: null });
            }}
            placeholder={t('settings.appearance.interface-font-placeholder')}
            previewText={t('settings.appearance.font-preview')}
            previewFont={resolveInterfaceFontFamily(
              settings.appearance.interfaceFontFamily
            )}
            resetDisabled={settings.appearance.interfaceFontFamily === null}
            resetLabel={t('settings.appearance.reset-interface-font')}
          />
          <FontFamilyEditor
            description={t('settings.appearance.terminal-font-description')}
            disabled={saving}
            draft={terminalFontDraft}
            label={t('settings.appearance.terminal-font')}
            onChange={setTerminalFontDraft}
            onCommit={() => commitFont('terminalFontFamily', terminalFontDraft)}
            onReset={() => {
              setTerminalFontDraft('');
              updateAppearance({ terminalFontFamily: null });
            }}
            placeholder={t('settings.appearance.terminal-font-placeholder')}
            previewText={t('settings.appearance.font-preview')}
            previewFont={resolveTerminalFontFamily(
              settings.appearance.terminalFontFamily
            )}
            resetDisabled={settings.appearance.terminalFontFamily === null}
            resetLabel={t('settings.appearance.reset-terminal-font')}
          />
        </div>
        <div className="appearance-control-grid">
          <AppearanceRange
            disabled={saving}
            label={t('settings.appearance.terminal-font-size')}
            max={MAXIMUM_TERMINAL_FONT_SIZE}
            min={MINIMUM_TERMINAL_FONT_SIZE}
            onChange={(value) => updateAppearance({ terminalFontSize: value })}
            suffix=" px"
            value={settings.appearance.terminalFontSize}
          />
        </div>
        <div className="appearance-font-presets">
          <div className="appearance-select-control">
            <span>{t('settings.appearance.font-preset')}</span>
            <SelectMenu
              disabled={saving || fontPresetsBusy}
              label={t('settings.appearance.font-preset')}
              onChange={setSelectedFontPreset}
              options={[
                { value: '', label: t('settings.appearance.choose-font-preset') },
                ...fontPresets.map((preset) => ({
                  value: preset.id,
                  label: preset.displayName
                }))
              ]}
              value={selectedFontPreset}
            />
          </div>
          <div className="provider-panel-actions">
            <button
              className="secondary-button"
              disabled={saving || selectedFontPreset === ''}
              onClick={() => {
                const preset = fontPresets.find(({ id }) => id === selectedFontPreset);
                if (preset === undefined) return;
                const next: Partial<AppearanceSettings> = {};
                if (preset.interfaceFontFamily !== null) {
                  next.interfaceFontFamily = preset.interfaceFontFamily;
                  setInterfaceFontDraft(preset.interfaceFontFamily);
                }
                if (preset.terminalFontFamily !== null) {
                  next.terminalFontFamily = preset.terminalFontFamily;
                  setTerminalFontDraft(preset.terminalFontFamily);
                }
                updateAppearance(next);
              }}
              type="button"
            >
              {t('settings.appearance.apply-font-preset')}
            </button>
            <button
              className="secondary-button"
              disabled={fontPresetsBusy}
              onClick={() => void loadFontPresets()}
              type="button"
            >
              {t('settings.appearance.refresh-font-presets')}
            </button>
          </div>
        </div>
        {rejectedFontPresets > 0 ? (
          <p className="general-setting-error" role="status">
            {t('settings.appearance.font-presets-rejected', {
              count: rejectedFontPresets
            })}
          </p>
        ) : null}
        {fontPresetsError ? (
          <p className="general-setting-error" role="alert">
            {t('settings.appearance.font-presets-error')}
          </p>
        ) : null}
      </section>

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

function FontFamilyEditor({
  description,
  disabled,
  draft,
  label,
  onChange,
  onCommit,
  onReset,
  placeholder,
  previewText,
  previewFont,
  resetDisabled,
  resetLabel
}: {
  description: string;
  disabled: boolean;
  draft: string;
  label: string;
  onChange(value: string): void;
  onCommit(): void;
  onReset(): void;
  placeholder: string;
  previewText: string;
  previewFont: string;
  resetDisabled: boolean;
  resetLabel: string;
}) {
  return (
    <div className="appearance-font-control">
      <label>
        <strong>{label}</strong>
        <span>{description}</span>
        <input
          aria-label={label}
          disabled={disabled}
          maxLength={128}
          onBlur={onCommit}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommit();
            }
          }}
          placeholder={placeholder}
          type="text"
          value={draft}
        />
      </label>
      <p
        className="appearance-font-preview"
        style={{ fontFamily: previewFont }}
      >
        {previewText}
      </p>
      <button
        className="secondary-button"
        disabled={disabled || resetDisabled}
        onClick={onReset}
        type="button"
      >
        {resetLabel}
      </button>
    </div>
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
