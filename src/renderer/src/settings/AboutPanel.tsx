import { useEffect, useState } from 'react';

import lumoraBrandMarkUrl from '../../../../resources/icons/lumora/source/lumora-symbol-gradient.svg';
import type {
  ApplicationAboutInfo,
  ApplicationReleaseStatus,
  LumoraApi,
  RemoteTargetSummary
} from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';

type AboutApi = Pick<
  LumoraApi,
  | 'getApplicationAboutInfo'
  | 'getApplicationReleaseStatus'
  | 'openLumoraProjectPage'
  | 'openApplicationReleasePage'
>;

export interface RemoteAboutTarget {
  connectionState: RemoteTargetSummary['target']['connectionState'];
  platform: RemoteTargetSummary['target']['platform'];
  architecture: RemoteTargetSummary['target']['architecture'];
  helperVersion: string | null;
}

export function AboutPanel({
  active,
  api = window.lumora,
  remoteTarget = null
}: {
  active: boolean;
  api?: AboutApi;
  remoteTarget?: RemoteAboutTarget | null;
}) {
  const { formatDate, t } = useLocalization();
  const [about, setAbout] = useState<ApplicationAboutInfo | null>(null);
  const [release, setRelease] = useState<ApplicationReleaseStatus | null>(null);
  const [openError, setOpenError] = useState(false);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setOpenError(false);
    void api.getApplicationAboutInfo().then(
      (value) => { if (current) setAbout(value); },
      () => { if (current) setAbout(null); }
    );
    void api.getApplicationReleaseStatus().then(
      (value) => { if (current) setRelease(value); },
      () => { if (current) setRelease(null); }
    );
    return () => { current = false; };
  }, [active, api]);

  const open = async (operation: () => Promise<unknown>) => {
    setOpenError(false);
    try {
      await operation();
    } catch {
      setOpenError(true);
    }
  };
  const platformName = (platform: string): string => {
    if (platform === 'win32') return t('settings.about.platform-windows');
    if (platform === 'darwin') return t('settings.about.platform-macos');
    if (platform === 'linux') return t('settings.about.platform-linux');
    return t('settings.about.platform-unknown');
  };

  return (
    <div className="about-panel">
      <section className="about-identity-card">
        <img alt="" className="about-logo" src={lumoraBrandMarkUrl} />
        <div>
          <p className="card-label">{t('settings.about.application')}</p>
          <h2>Lumora</h2>
          <p>{t('settings.about.description')}</p>
        </div>
        <button
          className="secondary-button"
          data-lumora-command
          onClick={() => void open(() => api.openLumoraProjectPage())}
          type="button"
        >{t('settings.about.open-project')}</button>
      </section>

      <section className="about-facts-card">
        <header><div><p className="card-label">{t('settings.about.installed-application')}</p><h3>{t('settings.about.system-information')}</h3></div></header>
        <dl className="about-facts">
          <div><dt>{t('settings.about.version')}</dt><dd>{about?.system.appVersion ?? t('common.states.unavailable')}</dd></div>
          <div><dt>{t('settings.about.developer')}</dt><dd>{about?.developer ?? 'HAYASAKA7'}</dd></div>
          <div><dt>{t('settings.about.local-system')}</dt><dd>{about === null ? t('common.states.unavailable') : `${platformName(about.system.platform)} · ${about.system.arch}`}</dd></div>
        </dl>
      </section>

      {remoteTarget !== null && (
        <section className="about-facts-card">
          <header><div><p className="card-label">{t('settings.about.remote-lumora')}</p><h3>{t('settings.about.connected-helper')}</h3></div></header>
          <dl className="about-facts">
            <div><dt>{t('settings.about.status')}</dt><dd>{remoteTarget.connectionState}</dd></div>
            <div><dt>{t('settings.about.remote-system')}</dt><dd>{`${platformName(remoteTarget.platform)} · ${remoteTarget.architecture}`}</dd></div>
            <div><dt>{t('settings.about.helper')}</dt><dd>{remoteTarget.helperVersion === null ? t('common.states.unavailable') : t('settings.about.helper-version', { version: remoteTarget.helperVersion })}</dd></div>
          </dl>
        </section>
      )}

      {release?.state === 'update_available' && (
        <section className="about-update-card" aria-label={t('settings.about.update-label')}>
          <header>
            <div><p className="card-label">{t('settings.about.update-label')}</p><h3>{release.release.version}</h3></div>
            <button
              className="refresh-button"
              data-lumora-command
              onClick={() => void open(() => api.openApplicationReleasePage())}
              type="button"
            >{t('settings.about.view-update')}</button>
          </header>
          <p>{release.release.summary || t('settings.about.newer-release')}</p>
          <p className="about-release-date">
            {t('settings.about.released', { date: formatDate(new Date(release.release.publishedAt)) })}
          </p>
        </section>
      )}

      {openError && (
        <p className="inline-notice warning" role="status">
          {t('settings.about.open-error')}
        </p>
      )}
    </div>
  );
}
