import { useEffect, useState } from 'react';

import type {
  LumoraApi,
  RemoteExecutionTargetId,
  RemoteTargetConnectionDetails,
  RemoteTargetCredentials,
  RemoteTargetSummary
} from '../../../shared/contracts';

interface RemoteTargetWindowProps {
  executionTargetId: RemoteExecutionTargetId;
  api?: LumoraApi;
}

function endpoint(summary: RemoteTargetSummary): string {
  const profile = summary.profile;
  return profile.route === 'direct'
    ? `${profile.username}@${profile.host}:${profile.port}`
    : `SSH config · ${profile.sshConfigHost}`;
}

export function RemoteTargetWindow({
  executionTargetId,
  api = window.lumora
}: RemoteTargetWindowProps) {
  const [summary, setSummary] = useState<RemoteTargetSummary | null>(null);
  const [details, setDetails] = useState<RemoteTargetConnectionDetails | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.listRemoteTargets().then(
      (targets) => {
        if (!active) return;
        const current = targets.find(
          ({ target }) => target.id === executionTargetId
        ) ?? null;
        setSummary(current);
        setError(current === null ? 'This remote target is unavailable.' : null);
      },
      () => {
        if (active) setError('Lumora could not load this remote target.');
      }
    );
    return () => { active = false; };
  }, [api, executionTargetId]);

  if (summary === null) {
    return (
      <main className="remote-window-shell">
        <section className="remote-window-card" aria-live="polite">
          <p className="eyebrow">Remote Lumora</p>
          <h1>Connecting to target manager</h1>
          <p>{error ?? 'Loading the isolated remote workspace…'}</p>
        </section>
      </main>
    );
  }

  const authentication = summary.profile.authentication;
  const credentials = (): RemoteTargetCredentials => {
    if (authentication.method === 'password') {
      return { method: 'password', password: secret };
    }
    if (authentication.method === 'private-key') {
      return { method: 'private-key', passphrase: secret || null };
    }
    return { method: 'agent' };
  };
  const trusted = summary.profile.verifiedHostFingerprint !== null;
  const connected = summary.target.connectionState === 'ready';

  const connect = async () => {
    if (!trusted || busy) return;
    setBusy(true);
    setError(null);
    try {
      const connectedDetails = await api.connectRemoteTarget({
        executionTargetId,
        credentials: credentials()
      });
      setSummary({
        target: connectedDetails.target,
        profile: connectedDetails.profile
      });
      setDetails(connectedDetails);
      setSecret('');
    } catch {
      setError('Lumora could not connect. Check the SSH credentials and try again.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSummary(await api.disconnectRemoteTarget(executionTargetId));
      setDetails(null);
    } catch {
      setError('Lumora could not disconnect this remote computer cleanly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="remote-window-shell">
      <section className="remote-window-card">
        <header className="remote-window-header">
          <div>
            <p className="eyebrow">Remote Lumora · isolated target</p>
            <h1>{summary.target.displayName}</h1>
            <p>{endpoint(summary)}</p>
          </div>
          <span className={`remote-state state-${summary.target.connectionState}`}>
            {summary.target.connectionState}
          </span>
        </header>

        <dl className="remote-facts">
          <div><dt>Platform</dt><dd>{summary.target.platform}</dd></div>
          <div><dt>Architecture</dt><dd>{summary.target.architecture}</dd></div>
          <div><dt>Home</dt><dd>{details?.homeDirectory ?? 'Detected after connection'}</dd></div>
          <div><dt>Shell</dt><dd>{details?.defaultShell ?? 'Detected after connection'}</dd></div>
        </dl>

        {!trusted && (
          <p className="inline-notice warning">
            Verify this computer in the local Lumora window before authentication.
          </p>
        )}
        {error !== null && <p className="inline-notice error">{error}</p>}

        {!connected && authentication.method === 'password' && (
          <label className="remote-secret-field">
            <span>SSH password</span>
            <input
              autoComplete="off"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </label>
        )}
        {!connected && authentication.method === 'private-key' && (
          <label className="remote-secret-field">
            <span>Private-key passphrase (optional)</span>
            <input
              autoComplete="off"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </label>
        )}

        <div className="remote-window-actions">
          {connected ? (
            <button className="secondary-button" disabled={busy} onClick={() => void disconnect()}>
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              className="refresh-button"
              disabled={
                busy || !trusted ||
                (authentication.method === 'password' && secret.length === 0)
              }
              onClick={() => void connect()}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>

        <footer className="remote-phase-note">
          Provider discovery, sessions, and terminals remain unavailable until the
          lightweight Lumora helper phase.
        </footer>
      </section>
    </main>
  );
}
