import type { ReactNode } from 'react';

import { settingMarker } from './settings-search';

/**
 * Holds the parts of one setting that sit apart in the layout, such as a
 * control and its buttons, so search matches and counts them as one. It adds
 * no box of its own, so the layout around it does not change.
 */
export function SettingBlock({
  children,
  description,
  modified,
  setting
}: {
  children: ReactNode;
  description?: string;
  modified?: boolean;
  setting: string;
}): ReactNode {
  return (
    <div className="setting-block" {...settingMarker(setting, description, modified)}>
      {children}
    </div>
  );
}
