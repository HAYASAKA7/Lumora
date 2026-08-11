import { useEffect, useState } from 'react';

import type {
  LumoraApi,
  RemoteAuthenticationProfile,
  RemoteConnectionProfileInput,
  RemoteExecutionTargetId,
  RemoteHostKeyObservation,
  RemoteTargetSummary
} from '../../../shared/contracts';
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

const ROUTE_OPTIONS = [
  { value: 'direct', label: 'Direct SSH' },
  { value: 'ssh-config', label: 'OpenSSH config alias' }
] as const;

const AUTHENTICATION_OPTIONS = [
  { value: 'agent', label: 'SSH agent' },
  { value: 'password', label: 'Password' },
  { value: 'private-key', label: 'Private key' }
] as const;

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

function validateForm(form: RemoteTargetFormState):
  | { ok: true; input: RemoteConnectionProfileInput }
  | { ok: false; message: string } {
  const displayName = form.displayName.trim();
  if (displayName.length === 0) {
    return { ok: false, message: 'Enter a name for this remote computer.' };
  }
  if (form.authenticationMethod === 'private-key' && form.privateKeyPath.trim().length === 0) {
    return { ok: false, message: 'Enter the private key path.' };
  }
  const authentication: RemoteAuthenticationProfile =
    form.authenticationMethod === 'private-key'
      ? { method: 'private-key', privateKeyPath: form.privateKeyPath.trim() }
      : { method: form.authenticationMethod };
  if (form.route === 'direct') {
    const host = form.host.trim();
    const username = form.username.trim();
    const port = Number(form.port);
    if (host.length === 0) return { ok: false, message: 'Enter the remote host.' };
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, message: 'Enter a port from 1 to 65535.' };
    }
    if (username.length === 0) {
      return { ok: false, message: 'Enter the SSH username.' };
    }
    return {
      ok: true,
      input: { displayName, route: 'direct', host, port, username, authentication }
    };
  }
  const sshConfigHost = form.sshConfigHost.trim();
  if (sshConfigHost.length === 0 || /\s/.test(sshConfigHost)) {
    return { ok: false, message: 'Enter one OpenSSH config alias without spaces.' };
  }
  return {
    ok: true,
    input: { displayName, route: 'ssh-config', sshConfigHost, authentication }
  };
}

function address(summary: RemoteTargetSummary): string {
  const profile = summary.profile;
  return profile.route === 'direct'
    ? `${profile.username}@${profile.host}:${profile.port}`
    : `OpenSSH config · ${profile.sshConfigHost}`;
}

export function RemoteTargetsView({ api = window.lumora }: { api?: LumoraApi }) {
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
          setError('Lumora could not load remote computers.');
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
      const validation = validateForm(form);
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
      setFormError('Lumora could not save this remote computer. Check the fields and try again.');
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
        'Lumora could not delete this remote computer. Disconnect it and try again.'
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
      setError('Lumora could not read the remote computer identity.');
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
      setError('Lumora could not save the trusted fingerprint.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="remote-targets-view">
      <header className="view-header remote-targets-heading">
        <div>
          <p className="eyebrow">Remote mode</p>
          <h1>Remote computers</h1>
          <p>Configure SSH access and open an isolated Lumora window for each computer.</p>
        </div>
        <button
          className="refresh-button"
          onClick={() => {
            setEditingId(null);
            setFormError(null);
            setForm({ ...EMPTY_FORM });
          }}
        >
          Add remote computer
        </button>
      </header>

      {error !== null && <p className="inline-notice error">{error}</p>}
      {loading ? (
        <p className="empty-state">Loading remote computers…</p>
      ) : targets.length === 0 ? (
        <p className="empty-state">No remote computers configured yet.</p>
      ) : (
        <div className="remote-target-grid">
          {targets.map((item) => {
            const trusted = item.profile.verifiedHostFingerprint !== null;
            return (
              <article className="remote-target-card" key={item.target.id}>
                <div className="remote-target-card-heading">
                  <div>
                    <h2>{item.target.displayName}</h2>
                    <p>{address(item)}</p>
                  </div>
                  <span className={`remote-state state-${item.target.connectionState}`}>
                    {item.target.connectionState}
                  </span>
                </div>
                <dl className="remote-target-meta">
                  <div><dt>Authentication</dt><dd>{item.profile.authentication.method}</dd></div>
                  <div><dt>Platform</dt><dd>{item.target.platform} · {item.target.architecture}</dd></div>
                  <div><dt>Identity</dt><dd>{trusted ? 'Verified' : 'Not verified'}</dd></div>
                </dl>
                <div className="remote-target-actions">
                  {trusted ? (
                    <button
                      className="refresh-button"
                      onClick={() => void api.openRemoteTargetWindow(item.target.id)}
                    >
                      Open remote Lumora
                    </button>
                  ) : (
                    <button
                      className="refresh-button"
                      disabled={busyId === item.target.id}
                      onClick={() => void verify(item.target.id)}
                    >
                      {busyId === item.target.id ? 'Checking…' : 'Verify identity'}
                    </button>
                  )}
                  <button
                    aria-label={`Edit ${item.target.displayName}`}
                    className="secondary-button"
                    onClick={() => {
                      setEditingId(item.target.id);
                      setFormError(null);
                      setForm(formFrom(item));
                    }}
                  >
                    Edit
                  </button>
                  <button
                    aria-label={`Delete ${item.target.displayName}`}
                    className="text-button danger-text"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(item);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {form !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section aria-label="Remote computer profile" aria-modal="true" className="new-session-dialog remote-profile-dialog" role="dialog">
            <header>
              <div>
                <p className="card-label">Remote connection</p>
                <h2>{editingId === null ? 'Add remote computer' : 'Edit remote computer'}</h2>
              </div>
              <button aria-label="Close remote computer profile" className="text-button" onClick={() => setForm(null)} type="button">Close</button>
            </header>
            <div className="dialog-body remote-profile-dialog-body" data-testid="remote-profile-dialog-body">
              <div className="remote-profile-fields">
              <label><span>Name</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
              <div className="remote-profile-field">
                <span>Connection route</span>
                <SelectMenu
                  label="Connection route"
                  onChange={(route) => setForm({ ...form, route })}
                  options={ROUTE_OPTIONS}
                  value={form.route}
                />
              </div>
              {form.route === 'direct' ? (
                <div className="remote-direct-fields">
                  <label><span>Host</span><input value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} /></label>
                  <label><span>Port</span><input inputMode="numeric" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label>
                  <label><span>Username</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
                </div>
              ) : (
                <label><span>SSH config alias</span><input value={form.sshConfigHost} onChange={(event) => setForm({ ...form, sshConfigHost: event.target.value })} /></label>
              )}
              <div className="remote-profile-field">
                <span>Authentication</span>
                <SelectMenu
                  label="Authentication"
                  onChange={(authenticationMethod) => setForm({ ...form, authenticationMethod })}
                  options={AUTHENTICATION_OPTIONS}
                  value={form.authenticationMethod}
                />
              </div>
              {form.authenticationMethod === 'private-key' && (
                <label><span>Private key path</span><input value={form.privateKeyPath} onChange={(event) => setForm({ ...form, privateKeyPath: event.target.value })} /></label>
              )}
              <p className="form-help">Passwords and key passphrases are requested only when connecting and are never saved.</p>
              {formError !== null && (
                <p className="inline-notice error" role="alert">{formError}</p>
              )}
              </div>
            </div>
            <footer className="modal-actions">
              <button className="secondary-button" onClick={() => setForm(null)}>Cancel</button>
              <button className="refresh-button" disabled={busyId === 'form'} onClick={() => void save()}>{busyId === 'form' ? 'Saving…' : 'Save remote computer'}</button>
            </footer>
          </section>
        </div>
      )}

      {deleting !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-label="Delete remote computer"
            aria-modal="true"
            className="new-session-dialog remote-delete-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="card-label">Remote connection</p>
                <h2>Delete remote computer</h2>
              </div>
              <button
                aria-label="Close remote computer deletion"
                className="text-button"
                disabled={busyId === deleting.target.id}
                onClick={() => setDeleting(null)}
                type="button"
              >Close</button>
            </header>
            <div className="dialog-body remote-delete-dialog-body">
              <p>
                Delete <strong>{deleting.target.displayName}</strong> from Lumora?
                Lumora will close its remote window and connection, but will not
                change anything on the remote computer.
              </p>
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
              >Cancel</button>
              <button
                className="secondary-button danger-text"
                disabled={busyId === deleting.target.id}
                onClick={() => void remove()}
                type="button"
              >{busyId === deleting.target.id ? 'Deleting…' : 'Delete remote computer'}</button>
            </footer>
          </section>
        </div>
      )}

      {observation !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section aria-label="Verify remote identity" aria-modal="true" className="new-session-dialog remote-fingerprint-dialog" role="dialog">
            <header>
              <div>
                <p className="card-label">Remote security</p>
                <h2>Verify remote identity</h2>
              </div>
              <button aria-label="Close remote identity verification" className="text-button" onClick={() => setObservation(null)} type="button">Close</button>
            </header>
            <div className="dialog-body remote-fingerprint-dialog-body">
              <p>Compare this SHA-256 fingerprint with the remote computer before trusting it.</p>
              <code>{observation.fingerprint}</code>
            </div>
            <footer className="modal-actions">
              <button className="secondary-button" onClick={() => setObservation(null)}>Cancel</button>
              <button className="refresh-button" onClick={() => void trust()}>Trust this fingerprint</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
