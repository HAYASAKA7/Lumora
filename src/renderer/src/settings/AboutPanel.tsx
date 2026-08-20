import { useEffect, useState } from 'react';

import lumoraBrandMarkUrl from '../../../../resources/icons/lumora/source/lumora-symbol-gradient.svg';
import type {
  ApplicationAboutInfo,
  ApplicationReleaseStatus,
  LumoraApi,
  RemoteTargetSummary
} from '../../../shared/contracts';

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

function platformName(platform: string): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return 'Unknown platform';
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

  return (
    <div className="about-panel">
      <section className="about-identity-card">
        <img alt="" className="about-logo" src={lumoraBrandMarkUrl} />
        <div>
          <p className="card-label">Application</p>
          <h2>Lumora</h2>
          <p>Native AI-agent workspace and session manager</p>
        </div>
        <button
          className="secondary-button"
          data-lumora-command
          onClick={() => void open(() => api.openLumoraProjectPage())}
          type="button"
        >Open GitHub project</button>
      </section>

      <section className="about-facts-card">
        <header><div><p className="card-label">Installed application</p><h3>System information</h3></div></header>
        <dl className="about-facts">
          <div><dt>Version</dt><dd>{about?.system.appVersion ?? 'Unavailable'}</dd></div>
          <div><dt>Developer</dt><dd>{about?.developer ?? 'HAYASAKA7'}</dd></div>
          <div><dt>Local system</dt><dd>{about === null ? 'Unavailable' : `${platformName(about.system.platform)} · ${about.system.arch}`}</dd></div>
        </dl>
      </section>

      {remoteTarget !== null && (
        <section className="about-facts-card">
          <header><div><p className="card-label">Remote Lumora</p><h3>Connected helper</h3></div></header>
          <dl className="about-facts">
            <div><dt>Status</dt><dd>{remoteTarget.connectionState}</dd></div>
            <div><dt>Remote system</dt><dd>{`${platformName(remoteTarget.platform)} · ${remoteTarget.architecture}`}</dd></div>
            <div><dt>Helper</dt><dd>{remoteTarget.helperVersion === null ? 'Unavailable' : `Helper ${remoteTarget.helperVersion}`}</dd></div>
          </dl>
        </section>
      )}

      {release?.state === 'update_available' && (
        <section className="about-update-card" aria-label="Update available">
          <header>
            <div><p className="card-label">Update available</p><h3>{release.release.version}</h3></div>
            <button
              className="refresh-button"
              data-lumora-command
              onClick={() => void open(() => api.openApplicationReleasePage())}
              type="button"
            >View update</button>
          </header>
          <p>{release.release.summary || 'A newer stable Lumora release is available.'}</p>
          <p className="about-release-date">
            Released {new Date(release.release.publishedAt).toLocaleDateString()}
          </p>
        </section>
      )}

      {openError && (
        <p className="inline-notice warning" role="status">
          Lumora could not open this page. Check your default browser and try again.
        </p>
      )}
    </div>
  );
}
