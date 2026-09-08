import type { ReactNode } from 'react';

import { CrossIcon } from './icons';
import { IconButton } from './IconButton';
import { useLocalization } from '../localization/useLocalization';

/**
 * Every dialog closes the same way, so the control is a cross rather than a
 * word: it costs no width, needs no translation to stay the same size, and is
 * the shape people already look for in a corner. The name it announces is
 * still a sentence, because "Close" alone tells a screen reader nothing about
 * what is closing.
 */
export function CloseButton({
  disabled = false,
  label,
  onClose,
  tabIndex
}: {
  disabled?: boolean;
  /** What is being closed, for assistive technology and the tooltip. */
  label?: string | undefined;
  onClose(): void;
  tabIndex?: number | undefined;
}): ReactNode {
  const { t } = useLocalization();

  return (
    <IconButton
      className="close-button"
      disabled={disabled}
      label={label ?? t('common.actions.close')}
      onClick={onClose}
      tabIndex={tabIndex}
    >
      <CrossIcon />
    </IconButton>
  );
}
