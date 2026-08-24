import type { ReactNode } from 'react';

import type { LaunchPreview } from '../../../shared/contracts';
import { LaunchConfiguration } from './LaunchConfiguration';
import { useLocalization } from '../localization/useLocalization';

export function LaunchDetails({
  preview
}: {
  preview: LaunchPreview;
}): ReactNode {
  const { t } = useLocalization();
  return (
    <details className="launch-details">
      <summary>{t('terminal.launch.details')}</summary>
      <LaunchConfiguration preview={preview} />
      <dl className="launch-preview">
        <div>
          <dt>{t('terminal.launch.executable')}</dt>
          <dd>{preview.executablePath}</dd>
        </div>
        <div>
          <dt>{t('terminal.launch.arguments')}</dt>
          <dd>{preview.args.length === 0 ? t('common.labels.none') : preview.args.join(' ')}</dd>
        </div>
        <div>
          <dt>{t('terminal.launch.working-directory')}</dt>
          <dd>{preview.workingDirectory}</dd>
        </div>
        <div>
          <dt>{t('terminal.launch.environment-names')}</dt>
          <dd>{preview.environmentNames.join(', ')}</dd>
        </div>
      </dl>
    </details>
  );
}
