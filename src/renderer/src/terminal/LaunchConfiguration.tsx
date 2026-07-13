import type { ReactNode } from 'react';

import type {
  LaunchPreview,
  LaunchSettingSource,
  ResolvedLaunchSetting
} from '../../../shared/contracts';

const SOURCE_LABELS: Record<LaunchSettingSource['scope'], string> = {
  default: 'Built-in default',
  global: 'Global layer',
  provider: 'Provider layer',
  workspace: 'Workspace layer',
  session: 'Session layer',
  launch: 'Launch override'
};

function valueLabel(
  setting: ResolvedLaunchSetting,
  preview: Pick<LaunchPreview, 'command' | 'terminalProfile'>
): string {
  if (setting.field === 'providerCommand') {
    return preview.command ?? 'Detected provider CLI';
  }
  return preview.terminalProfile.name;
}

function candidateLabel(
  setting: ResolvedLaunchSetting,
  value: string | null
): string {
  if (setting.field === 'providerCommand') {
    return value ?? 'Detected provider CLI';
  }
  return value ?? 'Automatic recommended profile';
}

export function LaunchConfiguration({
  preview
}: {
  preview: Pick<
    LaunchPreview,
    'command' | 'terminalProfile' | 'configuration'
  >;
}): ReactNode {
  const hasDetails = preview.configuration.some(
    (setting) =>
      setting.shadowed.length > 0 || setting.warnings.length > 0
  );

  return (
    <section className="launch-configuration" aria-labelledby="effective-launch-settings">
      <h3 id="effective-launch-settings">Effective launch settings</h3>
      <dl>
        {preview.configuration.map((setting) => (
          <div key={setting.field}>
            <dt>
              {setting.field === 'providerCommand'
                ? 'Provider command'
                : 'Terminal profile'}
            </dt>
            <dd>
              <strong>{valueLabel(setting, preview)}</strong>
              <span className="configuration-source">
                {SOURCE_LABELS[setting.winningSource.scope]}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {hasDetails ? (
        <details>
          <summary>Why these values?</summary>
          {preview.configuration.map((setting) => (
            setting.shadowed.length === 0 && setting.warnings.length === 0
              ? null
              : (
                <div className="configuration-details" key={setting.field}>
                  <strong>
                    {setting.field === 'providerCommand'
                      ? 'Provider command'
                      : 'Terminal profile'}
                  </strong>
                  {setting.shadowed.length === 0 ? null : (
                    <ul>
                      {setting.shadowed.map((candidate, index) => (
                        <li key={`${candidate.source.scope}-${index}`}>
                          {SOURCE_LABELS[candidate.source.scope]}:{' '}
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
