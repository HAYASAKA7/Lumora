import { useEffect, useState } from 'react';

import type {
  LumoraApi,
  RemoteAuthenticationProfile,
  RemoteConnectionProfileInput,
  RemoteExecutionTargetId,
  RemoteHostKeyObservation,
  RemoteTargetSummary
} from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { SelectMenu } from '../ui/SelectMenu';

interface RemoteTargetFormState {
  displayName: string;
  route: 'direct' | 'ssh-config';
  host: string;
  port: string;
  username: string;
  sshConfigHost: string;
  authenticationMethod: RemoteAuthenticationProfile['method'];
  privateKeyPath: string;
}

const EMPTY_FORM: RemoteTargetFormState = {
  displayName: '',
  route: 'direct',
  host: '',
  port: '22',
  username: '',
  sshConfigHost: '',
  authenticationMethod: 'agent',
  privateKeyPath: ''
};

function formFrom(summary: RemoteTargetSummary): RemoteTargetFormState {
  const profile = summary.profile;
  return {
    displayName: profile.displayName,
    route: profile.route,
    host: profile.host ?? '',
    port: String(profile.port ?? 22),
    username: profile.username ?? '',
    sshConfigHost: profile.sshConfigHost ?? '',
    authenticationMethod: profile.authentication.method,
    privateKeyPath: profile.authentication.method === 'private-key'
      ? profile.authentication.privateKeyPath
      : ''
  };
}

function validateForm(form: RemoteTargetFormState, t: (key: string) => string):
  | { ok: true; input: RemoteConnectionProfileInput }
  | { ok: false; message: string } {
  const displayName = form.displayName.trim();
  if (displayName.length === 0) {
    return { ok: false, message: t('remote.validation.name') };
  }
  if (form.authenticationMethod === 'private-key' && form.privateKeyPath.trim().length === 0) {
    return { ok: false, message: t('remote.validation.private-key') };
  }
  const authentication: RemoteAuthenticationProfile =
    form.authenticationMethod === 'private-key'
      ? { method: 'private-key', privateKeyPath: form.privateKeyPath.trim() }
      : { method: form.authenticationMethod };
  if (form.route === 'direct') {
    const host = form.host.trim();
    const username = form.username.trim();
    const port = Number(form.port);
    if (host.length === 0) return { ok: false, message: t('remote.validation.host') };
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, message: t('remote.validation.port') };
    }
    if (username.length === 0) {
      return { ok: false, message: t('remote.validation.username') };
    }
    return {
      ok: true,
      input: { displayName, route: 'direct', host, port, username, authentication }
    };
  }
  const sshConfigHost = form.sshConfigHost.trim();
  if (sshConfigHost.length === 0 || /\s/.test(sshConfigHost)) {
    return { ok: false, message: t('remote.validation.ssh-alias') };
  }
  return {
    ok: true,
    input: { displayName, route: 'ssh-config', sshConfigHost, authentication }
  };
}

function address(summary: RemoteTargetSummary, openSshConfig: string): string {
  const profile = summary.profile;
  return profile.route === 'direct'
    ? `${profile.username}@${profile.host}:${profile.port}`
    : `${openSshConfig} · ${profile.sshConfigHost}`;
}

export function RemoteTargetsView({ api = window.lumora }: { api?: LumoraApi }) {
  const { t } = useLocalization();
  const routeOptions = [
    { value: 'direct' as const, label: t('remote.profile.direct-ssh') },
    { value: 'ssh-config' as const, label: t('remote.profile.ssh-config-alias') }
  ];
  const authenticationOptions = [
    { value: 'agent' as const, label: t('remote.profile.ssh-agent') },
    { value: 'password' as const, label: t('remote.profile.password') },
    { value: 'private-key' as const, label: t('remote.profile.private-key') }
  ];
  const [targets, setTargets] = useState<RemoteTargetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<RemoteTargetFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<RemoteExecutionTargetId | null>(null);
  const [deleting, setDeleting] = useState<RemoteTargetSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [observation, setObservation] = useState<RemoteHostKeyObservation | null>(null);
  const [busyId, setBusyId] = useState<RemoteExecutionTargetId | 'form' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.listRemoteTargets().then(
      (items) => {
        if (active) {
          setTargets(items);
          setLoading(false);
        }
      },
      () => {
        if (active) {
          setLoading(false);
          setError(t('remote.errors.load-targets'));
        }
      }
    );
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (typeof api.onRemoteLifecycleEvent !== 'function') return;
    return api.onRemoteLifecycleEvent(({ snapshot }) => {
      const next = snapshot.summary;
      setTargets((current) => current.some(
        (item) => item.target.id === next.target.id
      )
        ? current.map((item) =>
            item.target.id === next.target.id ? next : item
          )
        : [...current, next]
      );
    });
  }, [api]);

  const replaceTarget = (next: RemoteTargetSummary) => {
    setTargets((current) => {
      const exists = current.some(({ target }) => target.id === next.target.id);
      return exists
        ? current.map((item) => item.target.id === next.target.id ? next : item)
        : [...current, next];
    });
  };

  const save = async () => {
    if (form === null || busyId !== null) return;
    setBusyId('form');
    setError(null);
    try {
      const validation = validateForm(form, t);
      if (!validation.ok) {
        setFormError(validation.message);
        return;
      }
      setFormError(null);
      const saved = editingId === null
        ? await api.createRemoteTarget(validation.input)
        : await api.updateRemoteTarget(editingId, validation.input);
      replaceTarget(saved);
      setForm(null);
      setEditingId(null);
    } catch {
      setFormError(t('remote.errors.save-target'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (deleting === null || busyId !== null) return;
    const id = deleting.target.id;
    setBusyId(id);
    setDeleteError(null);
    try {
      await api.removeRemoteTarget(id);
      setTargets((current) => current.filter(({ target }) => target.id !== id));
      setDeleting(null);
    } catch {
      setDeleteError(
        t('remote.errors.delete-target')
      );
    } finally {
      setBusyId(null);
    }
  };

  const verify = async (id: RemoteExecutionTargetId) => {
    setBusyId(id);
    setError(null);
    try {
      setObservation(await api.observeRemoteHost(id));
    } catch {
      setError(t('remote.errors.read-identity'));
    } finally {
      setBusyId(null);
    }
  };

  const trust = async () => {
    if (observation === null) return;
    setBusyId(observation.executionTargetId);
    try {
      replaceTarget(await api.trustRemoteHost(observation));
      setObservation(null);
    } catch {
      setError(t('remote.errors.save-fingerprint'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="remote-targets-view">
      <header className="view-header remote-targets-heading">
        <div>
          <p className="eyebrow">{t('remote.targets.eyebrow')}</p>
          <h1>{t('remote.targets.title')}</h1>
          <p>{t('remote.targets.description')}</p>
        </div>
        <button
          className="refresh-button"
          onClick={() => {
            setEditingId(null);
            setFormError(null);
            setForm({ ...EMPTY_FORM });
          }}
        >
          {t('remote.targets.add')}
        </button>
      </header>

      {error !== null && <p className="inline-notice error">{error}</p>}
      {loading ? (
        <p className="empty-state">{t('remote.targets.loading')}</p>
      ) : targets.length === 0 ? (
        <p className="empty-state">{t('remote.targets.empty')}</p>
      ) : (
        <div className="remote-target-grid">
          {targets.map((item) => {
            const trusted = item.profile.verifiedHostFingerprint !== null;
            return (
              <article className="remote-target-card" key={item.target.id}>
                <div className="remote-target-card-heading">
                  <div>
                    <h2>{item.target.displayName}</h2>
                    <p>{address(item, t('remote.profile.open-ssh-config'))}</p>
                  </div>
                  <span className={`remote-state state-${item.target.connectionState}`}>
                    {t(`remote.states.${item.target.connectionState}`)}
                  </span>
                </div>
                <dl className="remote-target-meta">
                  <div><dt>{t('remote.profile.authentication')}</dt><dd>{t(`remote.profile.authentication-${item.profile.authentication.method}`)}</dd></div>
                  <div><dt>{t('remote.targets.platform')}</dt><dd>{item.target.platform} · {item.target.architecture}</dd></div>
                  <div><dt>{t('remote.targets.identity')}</dt><dd>{t(trusted ? 'remote.targets.verified' : 'remote.targets.not-verified')}</dd></div>
                </dl>
                <div className="remote-target-actions">
                  {trusted ? (
                    <button
                      className="refresh-button"
                      onClick={() => void api.openRemoteTargetWindow(item.target.id)}
                    >
                      {t('remote.targets.open')}
                    </button>
                  ) : (
                    <button
                      className="refresh-button"
                      disabled={busyId === item.target.id}
                      onClick={() => void verify(item.target.id)}
                    >
                      {t(busyId === item.target.id ? 'remote.targets.checking' : 'remote.targets.verify')}
                    </button>
                  )}
                  <button
                    aria-label={t('remote.targets.edit-named', { name: item.target.displayName })}
                    className="secondary-button"
                    onClick={() => {
                      setEditingId(item.target.id);
                      setFormError(null);
                      setForm(formFrom(item));
                    }}
                  >
                    {t('common.actions.edit')}
                  </button>
                  <button
                    aria-label={t('remote.targets.delete-named', { name: item.target.displayName })}
                    className="text-button danger-text"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(item);
                    }}
                    type="button"
                  >
                    {t('common.actions.delete')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {form !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section aria-label={t('remote.profile.dialog-label')} aria-modal="true" className="new-session-dialog remote-profile-dialog" role="dialog">
            <header>
              <div>
                <p className="card-label">{t('remote.profile.eyebrow')}</p>
                <h2>{t(editingId === null ? 'remote.targets.add' : 'remote.targets.edit')}</h2>
              </div>
              <button aria-label={t('remote.profile.close-dialog')} className="text-button" onClick={() => setForm(null)} type="button">{t('common.actions.close')}</button>
            </header>
            <div className="dialog-body remote-profile-dialog-body" data-testid="remote-profile-dialog-body">
              <div className="remote-profile-fields">
              <label><span>{t('remote.profile.name')}</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
              <div className="remote-profile-field">
                <span>{t('remote.profile.route')}</span>
                <SelectMenu
                  label={t('remote.profile.route')}
                  onChange={(route) => setForm({ ...form, route })}
                  options={routeOptions}
                  value={form.route}
                />
              </div>
              {form.route === 'direct' ? (
                <div className="remote-direct-fields">
                  <label><span>{t('remote.profile.host')}</span><input value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} /></label>
                  <label><span>{t('remote.profile.port')}</span><input inputMode="numeric" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label>
                  <label><span>{t('remote.profile.username')}</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
                </div>
              ) : (
                <label><span>{t('remote.profile.ssh-config-input')}</span><input value={form.sshConfigHost} onChange={(event) => setForm({ ...form, sshConfigHost: event.target.value })} /></label>
              )}
              <div className="remote-profile-field">
                <span>{t('remote.profile.authentication')}</span>
                <SelectMenu
                  label={t('remote.profile.authentication')}
                  onChange={(authenticationMethod) => setForm({ ...form, authenticationMethod })}
                  options={authenticationOptions}
                  value={form.authenticationMethod}
                />
              </div>
              {form.authenticationMethod === 'private-key' && (
                <label><span>{t('remote.profile.private-key-path')}</span><input value={form.privateKeyPath} onChange={(event) => setForm({ ...form, privateKeyPath: event.target.value })} /></label>
              )}
              <p className="form-help">{t('remote.profile.secret-help')}</p>
              {formError !== null && (
                <p className="inline-notice error" role="alert">{formError}</p>
              )}
              </div>
            </div>
            <footer className="modal-actions">
              <button className="secondary-button" onClick={() => setForm(null)}>{t('common.actions.cancel')}</button>
              <button className="refresh-button" disabled={busyId === 'form'} onClick={() => void save()}>{t(busyId === 'form' ? 'common.actions.saving' : 'remote.profile.save')}</button>
            </footer>
          </section>
        </div>
      )}

      {deleting !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-label={t('remote.targets.delete-title')}
            aria-modal="true"
            className="new-session-dialog remote-delete-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="card-label">{t('remote.profile.eyebrow')}</p>
                <h2>{t('remote.targets.delete-title')}</h2>
              </div>
              <button
                aria-label={t('remote.targets.close-delete')}
                className="text-button"
                disabled={busyId === deleting.target.id}
                onClick={() => setDeleting(null)}
                type="button"
              >{t('common.actions.close')}</button>
            </header>
            <div className="dialog-body remote-delete-dialog-body">
              <p>{t('remote.targets.delete-confirm', { name: deleting.target.displayName })}</p>
              {deleteError !== null && (
                <p className="inline-notice error" role="alert">{deleteError}</p>
              )}
            </div>
            <footer className="modal-actions">
              <button
                className="secondary-button"
                disabled={busyId === deleting.target.id}
                onClick={() => setDeleting(null)}
                type="button"
              >{t('common.actions.cancel')}</button>
              <button
                className="secondary-button danger-text"
                disabled={busyId === deleting.target.id}
                onClick={() => void remove()}
                type="button"
              >{t(busyId === deleting.target.id ? 'common.actions.deleting' : 'remote.targets.delete-title')}</button>
            </footer>
          </section>
        </div>
      )}

      {observation !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section aria-label={t('remote.targets.verify')} aria-modal="true" className="new-session-dialog remote-fingerprint-dialog" role="dialog">
            <header>
              <div>
                <p className="card-label">{t('remote.targets.security')}</p>
                <h2>{t('remote.targets.verify')}</h2>
              </div>
              <button aria-label={t('remote.targets.close-verification')} className="text-button" onClick={() => setObservation(null)} type="button">{t('common.actions.close')}</button>
            </header>
            <div className="dialog-body remote-fingerprint-dialog-body">
              <p>{t('remote.targets.fingerprint-help')}</p>
              <code>{observation.fingerprint}</code>
            </div>
            <footer className="modal-actions">
              <button className="secondary-button" onClick={() => setObservation(null)}>{t('common.actions.cancel')}</button>
              <button className="refresh-button" onClick={() => void trust()}>{t('remote.targets.trust-fingerprint')}</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
