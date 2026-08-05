import { useEffect, useState } from 'react';

import type {
  LumoraApi,
  RemoteHelperInstallDetails,
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
  const [helperInstall, setHelperInstall] = useState<RemoteHelperInstallDetails | null>(null);
  const [showHelperInstall, setShowHelperInstall] = useState(false);
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
  const helperPending = summary.target.connectionState === 'helper-missing' ||
    summary.target.connectionState === 'helper-incompatible';

  const loadHelperInstall = async () => {
    try {
      setHelperInstall(await api.getRemoteHelperInstallDetails());
    } catch {
      setError('Lumora could not inspect the remote helper installation.');
    }
  };

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
      if (
        connectedDetails.target.connectionState === 'helper-missing' ||
        connectedDetails.target.connectionState === 'helper-incompatible'
      ) {
        await loadHelperInstall();
      } else {
        setHelperInstall(null);
      }
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
      setHelperInstall(null);
      setShowHelperInstall(false);
    } catch {
      setError('Lumora could not disconnect this remote computer cleanly.');
    } finally {
      setBusy(false);
    }
  };

  const installHelper = async () => {
    if (busy || helperInstall === null) return;
    setBusy(true);
    setError(null);
    try {
      const connectedDetails = await api.installRemoteHelper();
      setSummary({
        target: connectedDetails.target,
        profile: connectedDetails.profile
      });
      setDetails(connectedDetails);
      setHelperInstall(null);
      setShowHelperInstall(false);
    } catch {
      setError('Lumora could not install or start the remote helper.');
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

        {!connected && !helperPending && authentication.method === 'password' && (
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
        {!connected && !helperPending && authentication.method === 'private-key' && (
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
          ) : helperPending ? (
            <>
              <button className="secondary-button" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
              <button
                className="refresh-button"
                disabled={busy || helperInstall === null}
                onClick={() => setShowHelperInstall(true)}
              >
                Install Lumora helper
              </button>
            </>
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
          Remote helper activation is available. Provider discovery, sessions, and
          terminals arrive in the next remote phase.
        </footer>
      </section>
      {showHelperInstall && helperInstall !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-label="Install Lumora helper"
            aria-modal="true"
            className="new-session-dialog remote-helper-install-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="card-label">Remote helper</p>
                <h2>Install Lumora helper</h2>
              </div>
              <button
                aria-label="Close helper installation"
                className="text-button"
                disabled={busy}
                onClick={() => setShowHelperInstall(false)}
                type="button"
              >Close</button>
            </header>
            <div className="dialog-body remote-helper-dialog-body">
              <p>
                Lumora will install its lightweight helper for your account on
                <strong> {summary.target.displayName}</strong>. Administrator access is not required.
              </p>
              <dl className="remote-helper-install-facts">
                <div><dt>Version</dt><dd>{helperInstall.helperVersion}</dd></div>
                <div><dt>Location</dt><dd>{helperInstall.installLocation}</dd></div>
              </dl>
              {helperInstall.status === 'invalid' && (
                <p className="inline-notice warning">
                  The existing helper is invalid and will be replaced only after
                  the new copy has been verified.
                </p>
              )}
            </div>
            <footer className="modal-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setShowHelperInstall(false)}
              >Cancel</button>
              <button
                className="refresh-button"
                disabled={busy}
                onClick={() => void installHelper()}
              >{busy ? 'Installing…' : 'Install helper'}</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
