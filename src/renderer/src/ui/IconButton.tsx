import type { ReactNode } from 'react';

import { Tooltip } from './Tooltip';

/**
 * A button that shows only its icon. The name it would have carried moves into
 * the tooltip and the accessible name, so a row of repeated actions stays
 * short without becoming unreadable to anyone who cannot see the glyph.
 *
 * Use it for utility actions in a header or a row. An action that concludes a
 * flow, or that sits among worded choices, keeps its word.
 */
export function IconButton({
  children,
  className = '',
  disabled = false,
  label,
  onClick,
  tabIndex,
  tone = 'normal'
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** What the button does, for the tooltip and assistive technology. */
  label: string;
  onClick(): void;
  tabIndex?: number | undefined;
  tone?: 'normal' | 'danger';
}): ReactNode {
  const classes = [
    'icon-button',
    tone === 'danger' ? 'icon-button-danger' : '',
    className
  ].filter((entry) => entry !== '').join(' ');

  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className={classes}
        data-lumora-command
        disabled={disabled}
        onClick={onClick}
        {...(tabIndex === undefined ? {} : { tabIndex })}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}
