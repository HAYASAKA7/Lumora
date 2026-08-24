import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import type {
  ShellFamily,
  TerminalProfile
} from '../../../shared/contracts';
import { SelectMenu } from '../ui/SelectMenu';
import { useLocalization } from '../localization/useLocalization';

type ProfileStatus =
  | { state: 'loading' }
  | { state: 'ready'; profiles: TerminalProfile[] }
  | { state: 'error'; messageKey: string };

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
  const { t } = useLocalization();
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
        messageKey: 'terminal.profiles.load-failed'
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
          messageKey: 'terminal.profiles.save-failed'
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
        messageKey: 'terminal.profiles.delete-failed'
      })
    );
  };

  return (
    <div className="terminal-profile-layout">
      <section className="catalog-panel" aria-labelledby="profile-list-title">
        <div className="catalog-toolbar">
          <div>
            <p className="card-label">{t('terminal.profiles.local-detection')}</p>
            <h2 id="profile-list-title">{t('terminal.profiles.available')}</h2>
          </div>
          <button className="secondary-button" onClick={load} type="button">
            {t('terminal.profiles.refresh')}
          </button>
        </div>

        {status.state === 'loading' ? (
          <div className="catalog-state" role="status">{t('terminal.profiles.loading')}</div>
        ) : status.state === 'error' ? (
          <div className="catalog-state catalog-error" role="alert">
            {t(status.messageKey)}
          </div>
        ) : status.profiles.length === 0 ? (
          <div className="catalog-empty">
            <h3>{t('terminal.profiles.empty-title')}</h3>
            <p>{t('terminal.profiles.empty-description')}</p>
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
                      <span className="origin-badge origin-manual">{t('terminal.profiles.recommended')}</span>
                    ) : null}
                    {!profile.available ? (
                      <span className="availability-badge">{t('terminal.profiles.unavailable')}</span>
                    ) : null}
                  </div>
                </header>
                <p className="workspace-path">{profile.executablePath}</p>
                <p className="profile-arguments">
                  {profile.args.length === 0
                    ? t('terminal.profiles.no-arguments')
                    : profile.args.join(' · ')}
                </p>
                {profile.kind === 'custom' ? (
                  <button
                    className="text-button danger-text"
                    onClick={() => remove(profile.id)}
                    type="button"
                  >
                    {t('terminal.profiles.delete-custom')}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <form className="catalog-panel profile-form" onSubmit={submit}>
        <p className="card-label">{t('terminal.profiles.user-defined')}</p>
        <h2>{t('terminal.profiles.add')}</h2>
        <label>
          <span>{t('terminal.profiles.name')}</span>
          <input
            maxLength={80}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            value={name}
          />
        </label>
        <div className="select-field">
          <span>{t('terminal.profiles.shell-family')}</span>
          <SelectMenu
            label={t('terminal.profiles.shell-family')}
            onChange={(value) => setShellFamily(value as ShellFamily)}
            options={SHELL_FAMILIES.map((family) => ({
              value: family,
              label: family
            }))}
            value={shellFamily}
          />
        </div>
        <label>
          <span>{t('terminal.profiles.executable-path')}</span>
          <input
            onChange={(event) => setExecutablePath(event.currentTarget.value)}
            required
            value={executablePath}
          />
        </label>
        <label>
          <span>{t('terminal.profiles.base-arguments')}</span>
          <textarea
            onChange={(event) => setArgs(event.currentTarget.value)}
            rows={4}
            value={args}
          />
        </label>
        <button className="refresh-button" disabled={saving} type="submit">
          {t(saving ? 'terminal.profiles.saving' : 'terminal.profiles.save')}
        </button>
      </form>
    </div>
  );
}
