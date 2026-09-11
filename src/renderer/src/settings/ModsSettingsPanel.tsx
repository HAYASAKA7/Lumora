import { useCallback, useEffect, useState } from 'react';

import type {
  LocaleWarning,
  LumoraApi,
  ModsSettings
} from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { IconButton } from '../ui/IconButton';
import { FolderIcon, RefreshIcon } from '../ui/icons';

type ModsApi = Pick<
  LumoraApi,
  | 'getModsSettings'
  | 'chooseModsRoot'
  | 'resetModsRoot'
  | 'openModsRoot'
  | 'openUserLocaleFolder'
  | 'openFontPresetFolder'
  | 'openThemePresetFolder'
  | 'reloadLocalization'
>;

export function ModsSettingsPanel({
  active,
  api = window.lumora
}: {
  active: boolean;
  api?: ModsApi;
}) {
  const { snapshot, t } = useLocalization();
  const [settings, setSettings] = useState<ModsSettings | null>(null);
  const [busy, setBusy] = useState(false);
  // `busy` covers every Mods operation, opening a folder included; only a
  // reload is work worth showing on the reload button.
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      setSettings(await api.getModsSettings());
    } catch {
      setError(true);
    }
  }, [api]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const update = async (operation: () => Promise<ModsSettings | null>) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    setNotice(null);
    try {
      const next = await operation();
      if (next !== null) setSettings(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const warningText = (warning: LocaleWarning): string => {
    const keys: Record<LocaleWarning['code'], string> = {
      'invalid-user-pack': 'settings.general.language-warning-invalid',
      'unsupported-schema': 'settings.general.language-warning-schema',
      'catalog-version-mismatch': 'settings.general.language-warning-catalog',
      'unknown-message-key': 'settings.general.language-warning-key'
    };
    return t(keys[warning.code]);
  };

  return (
    <section className="catalog-panel mods-settings-panel">
      <header className="provider-panel-header">
        <div>
          <p className="card-label">{t('settings.mods.eyebrow')}</p>
          <h2>{t('settings.mods.title')}</h2>
          <p>{t('settings.mods.description')}</p>
        </div>
      </header>

      {error ? (
        <p className="general-setting-error" role="alert">
          {t('settings.mods.operation-failed')}
        </p>
      ) : null}
      {notice === null ? null : <p role="status">{notice}</p>}
      {snapshot.warnings.length === 0 ? null : (
        <div className="general-setting-error" role="alert">
          {[...new Set(snapshot.warnings.map(warningText))].map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      {settings === null ? (
        <p role="status">{t('settings.mods.loading')}</p>
      ) : (
        <section className="general-setting-group" aria-labelledby="mods-root-title">
          <h3 className="general-setting-group-title" id="mods-root-title">
            {t('settings.mods.root-title')}
          </h3>
          <div className="general-setting-group-rows">
            <div className="general-setting-row general-setting-row-control mods-setting-row">
              <span className="general-setting-copy">
                <strong>{t('settings.mods.root-label')}</strong>
                <code className="mods-path">{settings.rootPath}</code>
                <span>{t(settings.usesDefault
                  ? 'settings.mods.default-description'
                  : 'settings.mods.custom-description')}</span>
              </span>
              <div className="provider-panel-actions">
                <button
                  className="secondary-button"
                  data-lumora-command
                  disabled={busy}
                  onClick={() => void update(async () => {
                    const result = await api.chooseModsRoot();
                    return result.canceled ? null : result.settings;
                  })}
                  tabIndex={-1}
                  type="button"
                >
                  {t('settings.mods.choose-root')}
                </button>
                <button
                  className="secondary-button"
                  data-lumora-command
                  disabled={busy || settings.usesDefault}
                  onClick={() => void update(() => api.resetModsRoot())}
                  tabIndex={-1}
                  type="button"
                >
                  {t('settings.mods.restore-default')}
                </button>
                <IconButton
                  disabled={busy}
                  label={t('settings.mods.open-root')}
                  onClick={() => void update(async () => {
                    await api.openModsRoot();
                    return null;
                  })}
                  tabIndex={-1}
                >
                  <FolderIcon />
                </IconButton>
              </div>
            </div>
            <div className="general-setting-row general-setting-row-control mods-setting-row">
              <span className="general-setting-copy">
                <strong>{t('settings.mods.theme-packs')}</strong>
                <code className="mods-path">{settings.themesPath}</code>
                <span>{t('settings.mods.theme-packs-description')}</span>
              </span>
              <div className="provider-panel-actions">
                <IconButton
                  disabled={busy}
                  label={t('settings.mods.open-theme-packs')}
                  onClick={() => void update(async () => {
                    await api.openThemePresetFolder();
                    return null;
                  })}
                  tabIndex={-1}
                >
                  <FolderIcon />
                </IconButton>
              </div>
            </div>
            <div className="general-setting-row general-setting-row-control mods-setting-row">
              <span className="general-setting-copy">
                <strong>{t('settings.mods.font-presets')}</strong>
                <code className="mods-path">{settings.fontsPath}</code>
                <span>{t('settings.mods.font-presets-description')}</span>
              </span>
              <div className="provider-panel-actions">
                <IconButton
                  disabled={busy}
                  label={t('settings.mods.open-font-presets')}
                  onClick={() => void update(async () => {
                    await api.openFontPresetFolder();
                    return null;
                  })}
                  tabIndex={-1}
                >
                  <FolderIcon />
                </IconButton>
              </div>
            </div>
            <div className="general-setting-row general-setting-row-control mods-setting-row">
              <span className="general-setting-copy">
                <strong>{t('settings.mods.language-packs')}</strong>
                <code className="mods-path">{settings.localesPath}</code>
                <span>{t('settings.mods.language-packs-description')}</span>
              </span>
              <div className="provider-panel-actions">
                <IconButton
                  disabled={busy}
                  label={t('settings.mods.open-language-packs')}
                  onClick={() => void update(async () => {
                    await api.openUserLocaleFolder();
                    return null;
                  })}
                  tabIndex={-1}
                >
                  <FolderIcon />
                </IconButton>
                <IconButton
                  busy={reloading}
                  busyLabel={t('settings.mods.reloading-language-packs')}
                  disabled={busy}
                  label={t('settings.mods.reload-language-packs')}
                  onClick={() => {
                    setReloading(true);
                    void update(async () => {
                      const result = await api.reloadLocalization();
                      setNotice(result.rejectedUserPacks === 0
                        ? t('settings.mods.reload-complete')
                        : t('settings.mods.reload-rejected', {
                            count: result.rejectedUserPacks
                          }));
                      return null;
                    }).finally(() => setReloading(false));
                  }}
                  tabIndex={-1}
                >
                  <RefreshIcon />
                </IconButton>
              </div>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
