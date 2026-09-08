import type { ReactNode } from 'react';

import { Tooltip } from './Tooltip';
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
  const name = label ?? t('common.actions.close');

  return (
    <Tooltip content={name}>
      <button
        aria-label={name}
        className="close-button"
        data-lumora-command
        disabled={disabled}
        onClick={onClose}
        {...(tabIndex === undefined ? {} : { tabIndex })}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="icon"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
          viewBox="0 0 20 20"
        >
          <path d="M6 6l8 8M14 6l-8 8" />
        </svg>
      </button>
    </Tooltip>
  );
}
