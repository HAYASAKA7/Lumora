import { useEffect, useState } from 'react';

import type {
  LumoraApi,
  RemoteAuthenticationProfile,
  RemoteConnectionProfileInput,
  RemoteExecutionTargetId,
  RemoteHostKeyObservation,
  RemoteTargetSummary
} from '../../../shared/contracts';

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

function inputFrom(form: RemoteTargetFormState): RemoteConnectionProfileInput {
  const authentication: RemoteAuthenticationProfile =
    form.authenticationMethod === 'private-key'
      ? { method: 'private-key', privateKeyPath: form.privateKeyPath }
      : { method: form.authenticationMethod };
  return form.route === 'direct'
    ? {
        displayName: form.displayName,
        route: 'direct',
        host: form.host,
        port: Number(form.port),
        username: form.username,
        authentication
      }
    : {
        displayName: form.displayName,
        route: 'ssh-config',
        sshConfigHost: form.sshConfigHost,
        authentication
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
  const [editingId, setEditingId] = useState<RemoteExecutionTargetId | null>(null);
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
      const input = inputFrom(form);
      const saved = editingId === null
        ? await api.createRemoteTarget(input)
        : await api.updateRemoteTarget(editingId, input);
      replaceTarget(saved);
      setForm(null);
      setEditingId(null);
    } catch {
      setError('Check the connection profile fields and try again.');
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
          className="primary-button"
          onClick={() => {
            setEditingId(null);
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
                      className="primary-button"
                      onClick={() => void api.openRemoteTargetWindow(item.target.id)}
                    >
                      Open remote Lumora
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      disabled={busyId === item.target.id}
                      onClick={() => void verify(item.target.id)}
                    >
                      {busyId === item.target.id ? 'Checking…' : 'Verify identity'}
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setEditingId(item.target.id);
                      setForm(formFrom(item));
                    }}
                  >
                    Edit
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {form !== null && (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Remote computer profile" aria-modal="true" className="modal-card remote-profile-dialog" role="dialog">
            <header><h2>{editingId === null ? 'Add remote computer' : 'Edit remote computer'}</h2></header>
            <div className="remote-profile-fields">
              <label><span>Name</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
              <label><span>Connection route</span><select value={form.route} onChange={(event) => setForm({ ...form, route: event.target.value as RemoteTargetFormState['route'] })}><option value="direct">Direct SSH</option><option value="ssh-config">OpenSSH config alias</option></select></label>
              {form.route === 'direct' ? (
                <div className="remote-direct-fields">
                  <label><span>Host</span><input value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} /></label>
                  <label><span>Port</span><input inputMode="numeric" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label>
                  <label><span>Username</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
                </div>
              ) : (
                <label><span>SSH config alias</span><input value={form.sshConfigHost} onChange={(event) => setForm({ ...form, sshConfigHost: event.target.value })} /></label>
              )}
              <label><span>Authentication</span><select value={form.authenticationMethod} onChange={(event) => setForm({ ...form, authenticationMethod: event.target.value as RemoteAuthenticationProfile['method'] })}><option value="agent">SSH agent</option><option value="password">Password</option><option value="private-key">Private key</option></select></label>
              {form.authenticationMethod === 'private-key' && (
                <label><span>Private key path</span><input value={form.privateKeyPath} onChange={(event) => setForm({ ...form, privateKeyPath: event.target.value })} /></label>
              )}
              <p className="form-help">Passwords and key passphrases are requested only when connecting and are never saved.</p>
            </div>
            <footer className="modal-actions">
              <button className="secondary-button" onClick={() => setForm(null)}>Cancel</button>
              <button className="primary-button" disabled={busyId === 'form'} onClick={() => void save()}>{busyId === 'form' ? 'Saving…' : 'Save remote computer'}</button>
            </footer>
          </section>
        </div>
      )}

      {observation !== null && (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Verify remote identity" aria-modal="true" className="modal-card remote-fingerprint-dialog" role="dialog">
            <header><h2>Verify remote identity</h2></header>
            <p>Compare this SHA-256 fingerprint with the remote computer before trusting it.</p>
            <code>{observation.fingerprint}</code>
            <footer className="modal-actions">
              <button className="secondary-button" onClick={() => setObservation(null)}>Cancel</button>
              <button className="primary-button" onClick={() => void trust()}>Trust this fingerprint</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
