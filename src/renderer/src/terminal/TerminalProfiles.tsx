import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import type {
  ShellFamily,
  TerminalProfile
} from '../../../shared/contracts';

type ProfileStatus =
  | { state: 'loading' }
  | { state: 'ready'; profiles: TerminalProfile[] }
  | { state: 'error'; message: string };

const SHELL_FAMILIES: readonly ShellFamily[] = [
  'pwsh',
  'powershell',
  'cmd',
  'zsh',
  'bash',
  'fish',
  'other'
];

export function TerminalProfiles({
  onProfilesChange
}: {
  onProfilesChange?(profiles: TerminalProfile[]): void;
}): ReactNode {
  const [status, setStatus] = useState<ProfileStatus>({ state: 'loading' });
  const [name, setName] = useState('');
  const [shellFamily, setShellFamily] = useState<ShellFamily>('other');
  const [executablePath, setExecutablePath] = useState('');
  const [args, setArgs] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setStatus({ state: 'loading' });
    void window.lumora.getTerminalProfiles().then(
      (profiles) => {
        setStatus({ state: 'ready', profiles });
        onProfilesChange?.(profiles);
      },
      () => setStatus({
        state: 'error',
        message: 'Terminal profiles could not be loaded.'
      })
    );
  };

  useEffect(load, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    void window.lumora.saveTerminalProfile({
      name,
      shellFamily,
      executablePath,
      args: args
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    }).then(
      (profiles) => {
        setStatus({ state: 'ready', profiles });
        onProfilesChange?.(profiles);
        setName('');
        setExecutablePath('');
        setArgs('');
        setSaving(false);
      },
      () => {
        setStatus({
          state: 'error',
          message: 'The custom terminal profile could not be saved.'
        });
        setSaving(false);
      }
    );
  };

  const remove = (profileId: string) => {
    void window.lumora.deleteTerminalProfile(profileId).then(
      (profiles) => {
        setStatus({ state: 'ready', profiles });
        onProfilesChange?.(profiles);
      },
      () => setStatus({
        state: 'error',
        message: 'The custom terminal profile could not be deleted.'
      })
    );
  };

  return (
    <div className="terminal-profile-layout">
      <section className="catalog-panel" aria-labelledby="profile-list-title">
        <div className="catalog-toolbar">
          <div>
            <p className="card-label">Local shell detection</p>
            <h2 id="profile-list-title">Available profiles</h2>
          </div>
          <button className="secondary-button" onClick={load} type="button">
            Refresh profiles
          </button>
        </div>

        {status.state === 'loading' ? (
          <div className="catalog-state" role="status">Loading profiles</div>
        ) : status.state === 'error' ? (
          <div className="catalog-state catalog-error" role="alert">
            {status.message}
          </div>
        ) : status.profiles.length === 0 ? (
          <div className="catalog-empty">
            <h3>No shells detected</h3>
            <p>Add a custom absolute executable path below.</p>
          </div>
        ) : (
          <div className="profile-list">
            {status.profiles.map((profile) => (
              <article className="profile-card" key={profile.id}>
                <header>
                  <div>
                    <h3>{profile.name}</h3>
                    <span className="provider-badge">{profile.shellFamily}</span>
                  </div>
                  <div className="profile-badges">
                    {profile.recommended ? (
                      <span className="origin-badge origin-manual">Recommended</span>
                    ) : null}
                    {!profile.available ? (
                      <span className="availability-badge">Unavailable</span>
                    ) : null}
                  </div>
                </header>
                <p className="workspace-path">{profile.executablePath}</p>
                <p className="profile-arguments">
                  {profile.args.length === 0
                    ? 'No base arguments'
                    : profile.args.join(' · ')}
                </p>
                {profile.kind === 'custom' ? (
                  <button
                    className="text-button danger-text"
                    onClick={() => remove(profile.id)}
                    type="button"
                  >
                    Delete custom profile
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <form className="catalog-panel profile-form" onSubmit={submit}>
        <p className="card-label">User-defined profile</p>
        <h2>Add terminal profile</h2>
        <label>
          <span>Name</span>
          <input
            maxLength={80}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            value={name}
          />
        </label>
        <label>
          <span>Shell family</span>
          <select
            onChange={(event) =>
              setShellFamily(event.currentTarget.value as ShellFamily)
            }
            value={shellFamily}
          >
            {SHELL_FAMILIES.map((family) => (
              <option key={family} value={family}>{family}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Absolute executable path</span>
          <input
            onChange={(event) => setExecutablePath(event.currentTarget.value)}
            required
            value={executablePath}
          />
        </label>
        <label>
          <span>Base arguments (one per line)</span>
          <textarea
            onChange={(event) => setArgs(event.currentTarget.value)}
            rows={4}
            value={args}
          />
        </label>
        <button className="refresh-button" disabled={saving} type="submit">
          {saving ? 'Saving profile' : 'Save profile'}
        </button>
      </form>
    </div>
  );
}
