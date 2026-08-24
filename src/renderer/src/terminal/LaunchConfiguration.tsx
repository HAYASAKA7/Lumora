import type { ReactNode } from 'react';

import type {
  LaunchPreview,
  LaunchSettingSource,
  ResolvedLaunchSetting
} from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';

const SOURCE_KEYS: Record<LaunchSettingSource['scope'], string> = {
  default: 'terminal.launch.source-default',
  global: 'terminal.launch.source-global',
  provider: 'terminal.launch.source-provider',
  workspace: 'terminal.launch.source-workspace',
  session: 'terminal.launch.source-session',
  launch: 'terminal.launch.source-launch'
};

export function LaunchConfiguration({
  preview
}: {
  preview: Pick<
    LaunchPreview,
    'command' | 'terminalProfile' | 'configuration'
  >;
}): ReactNode {
  const { t } = useLocalization();
  const fieldLabel = (setting: ResolvedLaunchSetting) => t(
    setting.field === 'providerCommand'
      ? 'terminal.launch.provider-command'
      : 'terminal.launch.terminal-profile'
  );
  const valueLabel = (setting: ResolvedLaunchSetting): string =>
    setting.field === 'providerCommand'
      ? preview.command ?? t('terminal.launch.detected-provider-cli')
      : preview.terminalProfile.name;
  const candidateLabel = (setting: ResolvedLaunchSetting, value: string | null): string =>
    setting.field === 'providerCommand'
      ? value ?? t('terminal.launch.detected-provider-cli')
      : value ?? t('terminal.launch.automatic-profile');
  const hasDetails = preview.configuration.some(
    (setting) =>
      setting.shadowed.length > 0 || setting.warnings.length > 0
  );

  return (
    <section className="launch-configuration" aria-labelledby="effective-launch-settings">
      <h3 id="effective-launch-settings">{t('terminal.launch.effective-settings')}</h3>
      <dl>
        {preview.configuration.map((setting) => (
          <div key={setting.field}>
            <dt>
              {fieldLabel(setting)}
            </dt>
            <dd>
              <strong>{valueLabel(setting)}</strong>
              <span className="configuration-source">
                {t(SOURCE_KEYS[setting.winningSource.scope])}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {hasDetails ? (
        <details>
          <summary>{t('terminal.launch.why-values')}</summary>
          {preview.configuration.map((setting) => (
            setting.shadowed.length === 0 && setting.warnings.length === 0
              ? null
              : (
                <div className="configuration-details" key={setting.field}>
                  <strong>
                    {fieldLabel(setting)}
                  </strong>
                  {setting.shadowed.length === 0 ? null : (
                    <ul>
                      {setting.shadowed.map((candidate, index) => (
                        <li key={`${candidate.source.scope}-${index}`}>
                          {t(SOURCE_KEYS[candidate.source.scope])}:{' '}
                          {candidateLabel(setting, candidate.value)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {setting.warnings.map((warning) => (
                    <p className="configuration-warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                </div>
              )
          ))}
        </details>
      ) : null}
    </section>
  );
}
