import type { ReactNode } from 'react';

import type { LaunchPreview } from '../../../shared/contracts';
import { LaunchConfiguration } from './LaunchConfiguration';

export function LaunchDetails({
  preview
}: {
  preview: LaunchPreview;
}): ReactNode {
  return (
    <details className="launch-details">
      <summary>Launch details</summary>
      <LaunchConfiguration preview={preview} />
      <dl className="launch-preview">
        <div>
          <dt>Executable</dt>
          <dd>{preview.executablePath}</dd>
        </div>
        <div>
          <dt>Arguments</dt>
          <dd>{preview.args.length === 0 ? 'None' : preview.args.join(' ')}</dd>
        </div>
        <div>
          <dt>Working directory</dt>
          <dd>{preview.workingDirectory}</dd>
        </div>
        <div>
          <dt>Environment names</dt>
          <dd>{preview.environmentNames.join(', ')}</dd>
        </div>
      </dl>
    </details>
  );
}
